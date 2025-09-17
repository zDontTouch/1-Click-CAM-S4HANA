// ==UserScript==
// @name     1-Click CAM Tool S/4Hana Cloud
// @version  1.0
// @grant    none
// @match    *://itsm.services.sap/*
// @include  *://itsm.services.sap/*
// @exclude  *://itsm.services.sap/attach_knowledge*
// @exclude  *://itsm.services.sap/*record/incident*
// ==/UserScript==

/*
 * For example cases you can check Guided Engineering backend:
 * https://supportportaltest-ge-approuter.internal.cfapps.sap.hana.ondemand.com/ahui/#/SupportCase
 */
const forceEnv = null;

// Exposed functions
API = {
  openQuickView,
  sendAnalytics,
  getTemplates,
  Pulse: {
    get: getPulse,
    update: updatePulse,
  },
  GuidedEngineering: {
    getHistoryData,
    getAvailableAutomationsForComponent,
    executeAutomation,
    addFeedbackForAutomation,
  },
};

/**
 * Get pulse record
 */
async function getPulse(case_id) {
  try {
    const res = await caRequest(`/case/pulse/${case_id}`);
    if (res?.length) {
      return res[0];
    }
    if (Array.isArray(res) && res.length === 0) {
      return "New";
    }
    return null;
  } catch (e) {
    console.error(e);
    return null;
  }
}

/**
 * Update pulse record
 */
async function updatePulse(case_id, data) {
  const res = await caRequest(`/case/pulse/${case_id}`, "POST", data);
  return res;
}

function higherVersion(v1, v2) {
  var v1parts = v1.split(".").map(Number);
  var v2parts = v2.split(".").map(Number);
  for (var i = 0; i < v1parts.length; ++i) {
    if (v2parts.length == i) {
      return v1;
    }
    if (v1parts[i] == v2parts[i]) {
      continue;
    } else if (v1parts[i] > v2parts[i]) {
      return v1;
    } else {
      return v2;
    }
  }
  if (v1parts.length != v2parts.length) {
    return v2;
  }
  return v1;
}

async function getTemplates() {
  try {
    const minVersion = "1.6.44";
    const iseVersion = await window.ise.system_info.getISEVersion();
    if (higherVersion(iseVersion, minVersion) === minVersion) {
      return [];
    }
    const res = await ise.events.send("engine-case-get-templates");
    if (!res?.length) {
      return null;
    }
    const parsed = JSON.parse(res);
    const parsedKeys = Object.keys(parsed);
    const templates = [];
    for (let i = 0; i < parsedKeys.length; i++) {
      if (parsedKeys[i].startsWith("template_metadata_")) {
        const template = JSON.parse(parsed[parsedKeys[i]]);
        const templateText = parsed["template_text_" + template.id];
        templates.push({ title: template.title, description: "Maintained by the ServiceNow Tools script.", content: templateText });
      }
    }
    return templates;
  } catch (e) {
    console.error(e);
    return null;
  }
}

async function openQuickView(url) {
  ise.events.send("browserwindow-isewindow-popupwindow-open", url);
}

/**
 * Get Intelligent Automation history for a given correlation id
 */
async function getHistoryData(correlation_id) {
  const res = await iaRequest(`/automations/history/${correlation_id}`);
  if (res?.length) {
    res.sort((a, b) => {
      try {
        if (a?.status === "RUNNING") return -1;
        if (b?.status === "RUNNING") return -1;
        if (moment(a?.completed_ts) > moment(b?.completed_ts)) {
          return -1;
        }
        return 1;
      } catch (e) {
        return 1;
      }
    });
  }
  return res;
}

/**
 * Add feedback for automation
 */
async function addFeedbackForAutomation(automation_id, workflow_id, val) {
  let payload = {
    automation_id,
    workflow_id,
  };
  if (val === null) {
    payload.thumb_up = false;
    payload.thumb_down = false;
  } else {
    if (val) {
      payload.thumb_up = true;
      payload.thumb_down = false;
    } else {
      payload.thumb_up = false;
      payload.thumb_down = true;
    }
  }
  const res = await iaRequest(`/automation/feedback`, "POST", payload);
  return res;
}

/**
 * Get list of Intelligent Automation automations
 */
async function getAvailableAutomationsForComponent(component, product_name) {
  let res = null;
  if (product_name?.length) {
    res = await iaRequest(`/automations/${component}?product=${encodeURIComponent(product_name)}`);
  } else {
    res = await iaRequest(`/automations/${component}`);
  }
  return res;
}

/**
 * Execute an automation for a case
 */
async function executeAutomation(automation_id, correlation_id, component, runtimeOptions) {
  let options = [];
  if (runtimeOptions) {
    runtimeOptions = Object.values(runtimeOptions);
  }
  if (runtimeOptions?.length) {
    for (let i = 0; i < runtimeOptions.length; i++) {
      let values = [];
      // Selectbox
      if (runtimeOptions[i]?.control === "selectbox") {
        if (runtimeOptions[i].values?.value) {
          // Single
          values = [runtimeOptions[i].values.value];
        } else {
          // Multi
          values = runtimeOptions[i].values.map((item) => item.value);
        }
      } else {
        // Freetext
        values = [runtimeOptions[i]?.value || ""];
      }
      options.push({
        name: runtimeOptions[i].option.name,
        values,
      });
    }
  }
  const res = await iaRequest(`/automation/execute`, "POST", {
    id: automation_id,
    incident_no: correlation_id,
    component,
    options,
  });
  return res;
}

/**
 * Sends analytics to HANA
 */
async function sendAnalytics(action, metadata = undefined) {
  ise.events.send("engine-logger-track-hana", {
    view: "case_assistant",
    action,
    metadata,
  });
}

/**
 * Make request to backend-case-assistant
 */
let caToken = null;
async function caRequest(path, method = "GET", body = undefined) {
  if (!caToken) {
    const tokenRes = await ise.events.send("engine-sso-request", {
      env: forceEnv || undefined,
      service: "supportportal_token",
    });
    caToken = tokenRes?.token;
  }
  const res = await ise.events.send("engine-request", {
    service: "backend-case-assistant",
    method,
    env: forceEnv || undefined,
    body,
    path,
    headers: {
      Authorization: `Bearer ${caToken}`,
    },
  });
  return res;
}

/**
 * Make request to backend-guided-engineering
 */

async function iaRequest(path, method = "GET", body = undefined) {
  document.querySelector(".spinner").style.display = "block";

  const tokenRes = await ise.events.send("engine-sso-request", {
    env: forceEnv || undefined,
    service: "guided-engineering-token",
  });
  let iaToken = tokenRes?.token;

  const res = await ise.events.send("engine-request", {
    service: "backend-guided-engineering",
    method,
    env: forceEnv || undefined,
    body,
    path,
    headers: {
      Authorization: `Bearer ${iaToken}`,
    },
  });
  document.querySelector(".spinner").style.display = "none";
  return res;
}

/*****************************************************************************************************/

var camButton = document.createElement("button");
camButton.setAttribute("id","camButton");
camButton.setAttribute("style","cursor:pointer; z-index:99; display:block; position:absolute; right:162px; top:155px; vertical-align:middle; padding:5.5px 12px; background-color:RGB(var(--now-button--secondary--background-color--hover,var(--now-color--neutral-3,209,214,214)),var(--now-button--secondary--background-color-alpha--hover,var(--now-button--secondary--background-color-alpha,1))); border-color:RGB(var(--now-button--secondary--border-color,var(--now-color--neutral-7,135,147,148))); border-radius:var(--now-button--secondary--border-radius,var(--now-button--border-radius,var(--now-actionable--border-radius,0))); border-width:var(--now-button--secondary--border-width,var(--now-button--border-width,var(--now-actionable--border-width,1px))); color:RGB(var(--now-button--secondary--color,var(--now-color--neutral-18,22,27,28))); font-family: var(--now-button--font-family,var(--now-actionable--font-family,var(--now-font-family,\"Source Sans Pro\",Arial,sans-serif))); font-style:var(--now-button--font-style,var(--now-actionable--font-style,normal)); font-weight:var(--now-button--font-weight,var(--now-actionable--font-weight,normal)); font-size:1rem; line-weight:1.25;");
camButton.innerHTML = "1-Click CAM";

var tenantTextBox = document.createElement("input");
tenantTextBox.setAttribute("id","camText");
tenantTextBox.setAttribute("style","z-index:99; display:block; position:absolute; width:85px; height:25px; right:395px; top:155px; background-color:RGB(var(--now-button--secondary--background-color--hover,var(--now-color--neutral-3,209,214,214)),var(--now-button--secondary--background-color-alpha--hover,var(--now-button--secondary--background-color-alpha,1))); border-color:RGB(var(--now-button--secondary--border-color,var(--now-color--neutral-7,135,147,148))); border-radius:var(--now-button--secondary--border-radius,var(--now-button--border-radius,var(--now-actionable--border-radius,0))); font-family: var(--now-form-field--font-family, var(--now-font-family, \"Source Sans Pro\", Arial, sans-serif)); color:grey;");
tenantTextBox.setAttribute("placeholder","System/Client");

var cbuserTextBox = document.createElement("input");
cbuserTextBox.setAttribute("id","userText");
cbuserTextBox.setAttribute("style","z-index:99; display:block; position:absolute; width:100px; height:25px; right:285px; top:155px; background-color:RGB(var(--now-button--secondary--background-color--hover,var(--now-color--neutral-3,209,214,214)),var(--now-button--secondary--background-color-alpha--hover,var(--now-button--secondary--background-color-alpha,1))); border-color:RGB(var(--now-button--secondary--border-color,var(--now-color--neutral-7,135,147,148))); border-radius:var(--now-button--secondary--border-radius,var(--now-button--border-radius,var(--now-actionable--border-radius,0))); font-family: var(--now-form-field--font-family, var(--now-font-family, \"Source Sans Pro\", Arial, sans-serif)); color:grey;");
cbuserTextBox.setAttribute("placeholder","CB user");

var caseData;

document.addEventListener("mousedown",(e)=>{
  if(e.target.id == "camButton"){
    if(document.getElementById("camText").value == ""){
      if(document.getElementById("userText").value.toString().trim() == ""){
        ise.tab.add("https://spc.ondemand.com/sap/bc/webdynpro/a1sspc/cam_sup_central?TENANT_ID="+caseData.headers.data.systemNumber+"&access_level=SUPPORT_EXTENDED&TYPE=SN&POINTER="+caseData.id+"#", { show: true } );
        ise.tab.add(caseData.headers.data.installBase.url, { show: false } );
      }else{
        ise.tab.add("https://spc.ondemand.com/sap/bc/webdynpro/a1sspc/cam_sup_central?TENANT_ID="+caseData.headers.data.systemNumber+"&access_level=SUPPORT_EXTENDED&TYPE=SN&additional_parameter=ADDAUTH_USER&copyuser="+document.getElementById("userText").value.toString().trim()+"&POINTER="+caseData.id+"#", { show: true } );
        ise.tab.add(caseData.headers.data.installBase.url, { show: false } );
      }
      
    }else{
      //tries to split values like "abc/123"
      var trimmed 
      trimmed = document.getElementById("camText").value.toString().trim().split("/");
      if(trimmed.length<2){
        //tries to split values like "abc 123"
        trimmed = document.getElementById("camText").value.toString().trim().split(" ");
        if(trimmed.length<2){
          //splits using lenght (3 for system, 3 for client)
          trimmed[0] = document.getElementById("camText").value.toString().trim().slice(0,3).trim();
          trimmed[1] = document.getElementById("camText").value.toString().trim().slice(3).trim();
        }
      }
      if(document.getElementById("userText").value.toString().trim() == ""){
        ise.tab.add("https://spc.ondemand.com/sap/bc/webdynpro/a1sspc/cam_sup_central?sid="+trimmed[0]+"&client="+trimmed[1]+"&access_level=SUPPORT_EXTENDED&TYPE=SN&POINTER="+caseData.id+"#", { show: true } );
      }else{
        ise.tab.add("https://spc.ondemand.com/sap/bc/webdynpro/a1sspc/cam_sup_central?sid="+trimmed[0]+"&client="+trimmed[1]+"&access_level=SUPPORT_EXTENDED&TYPE=SN&additional_parameter=ADDAUTH_USER&copyuser="+document.getElementById("userText").value.toString().trim()+"&POINTER="+caseData.id+"#", { show: true } );
      }
      document.getElementById("camText").value = "";
      document.getElementById("userText").value = "";
    }

  }
});

navigation.addEventListener("navigate", e => {
  if(e.destination.url.toString().indexOf("/record/incident")>=0){
    camButton.setAttribute("style","cursor:pointer; z-index:99; display:block; position:absolute; right:162px; top:196px; vertical-align:middle; padding:5.5px 12px; background-color:RGB(var(--now-button--secondary--background-color--hover,var(--now-color--neutral-3,209,214,214)),var(--now-button--secondary--background-color-alpha--hover,var(--now-button--secondary--background-color-alpha,1))); border-color:RGB(var(--now-button--secondary--border-color,var(--now-color--neutral-7,135,147,148))); border-radius:var(--now-button--secondary--border-radius,var(--now-button--border-radius,var(--now-actionable--border-radius,0))); border-width:var(--now-button--secondary--border-width,var(--now-button--border-width,var(--now-actionable--border-width,1px))); color:RGB(var(--now-button--secondary--color,var(--now-color--neutral-18,22,27,28))); font-family: var(--now-button--font-family,var(--now-actionable--font-family,var(--now-font-family,\"Source Sans Pro\",Arial,sans-serif))); font-style:var(--now-button--font-style,var(--now-actionable--font-style,normal)); font-weight:var(--now-button--font-weight,var(--now-actionable--font-weight,normal)); font-size:1rem; line-weight:1.25;");
    document.body.appendChild(camButton);
    tenantTextBox.setAttribute("style","z-index:99; display:block; position:absolute; width:85px; height:25px; right:395px; top:196px; background-color:RGB(var(--now-button--secondary--background-color--hover,var(--now-color--neutral-3,209,214,214)),var(--now-button--secondary--background-color-alpha--hover,var(--now-button--secondary--background-color-alpha,1))); border-color:RGB(var(--now-button--secondary--border-color,var(--now-color--neutral-7,135,147,148))); border-radius:var(--now-button--secondary--border-radius,var(--now-button--border-radius,var(--now-actionable--border-radius,0))); font-family: var(--now-form-field--font-family, var(--now-font-family, \"Source Sans Pro\", Arial, sans-serif)); color:grey;");
    document.body.appendChild(tenantTextBox);
    cbuserTextBox.setAttribute("style","z-index:99; display:block; position:absolute; width:100px; height:25px; right:285px; top:196px; background-color:RGB(var(--now-button--secondary--background-color--hover,var(--now-color--neutral-3,209,214,214)),var(--now-button--secondary--background-color-alpha--hover,var(--now-button--secondary--background-color-alpha,1))); border-color:RGB(var(--now-button--secondary--border-color,var(--now-color--neutral-7,135,147,148))); border-radius:var(--now-button--secondary--border-radius,var(--now-button--border-radius,var(--now-actionable--border-radius,0))); font-family: var(--now-form-field--font-family, var(--now-font-family, \"Source Sans Pro\", Arial, sans-serif)); color:grey;");
    document.body.appendChild(cbuserTextBox);
  }else if(caseData.types[0] == "nocase"){
    document.body.removeChild(document.getElementById("camButton"));
    document.getElementById("camText").value = "";
    document.body.removeChild(document.getElementById("camText"));
    document.getElementById("userText").value = "";
    document.body.removeChild(document.getElementById("userText"));
  }else if(e.destination.url.toString().indexOf("kb_template_kcs_article")>=0 || e.destination.url.toString().indexOf("sn_customerservice_action_plans")>=0){
    camButton.setAttribute("style","cursor:pointer; z-index:99; display:block; position:absolute; right:162px; top:196px; vertical-align:middle; padding:5.5px 12px; background-color:RGB(var(--now-button--secondary--background-color--hover,var(--now-color--neutral-3,209,214,214)),var(--now-button--secondary--background-color-alpha--hover,var(--now-button--secondary--background-color-alpha,1))); border-color:RGB(var(--now-button--secondary--border-color,var(--now-color--neutral-7,135,147,148))); border-radius:var(--now-button--secondary--border-radius,var(--now-button--border-radius,var(--now-actionable--border-radius,0))); border-width:var(--now-button--secondary--border-width,var(--now-button--border-width,var(--now-actionable--border-width,1px))); color:RGB(var(--now-button--secondary--color,var(--now-color--neutral-18,22,27,28))); font-family: var(--now-button--font-family,var(--now-actionable--font-family,var(--now-font-family,\"Source Sans Pro\",Arial,sans-serif))); font-style:var(--now-button--font-style,var(--now-actionable--font-style,normal)); font-weight:var(--now-button--font-weight,var(--now-actionable--font-weight,normal)); font-size:1rem; line-weight:1.25;");
          tenantTextBox.setAttribute("style","z-index:99; display:block; position:absolute; width:85px; height:25px; right:395px; top:196px; background-color:RGB(var(--now-button--secondary--background-color--hover,var(--now-color--neutral-3,209,214,214)),var(--now-button--secondary--background-color-alpha--hover,var(--now-button--secondary--background-color-alpha,1))); border-color:RGB(var(--now-button--secondary--border-color,var(--now-color--neutral-7,135,147,148))); border-radius:var(--now-button--secondary--border-radius,var(--now-button--border-radius,var(--now-actionable--border-radius,0))); font-family: var(--now-form-field--font-family, var(--now-font-family, \"Source Sans Pro\", Arial, sans-serif)); color:grey;");
          cbuserTextBox.setAttribute("style","z-index:99; display:block; position:absolute; width:100px; height:25px; right:285px; top:196px; background-color:RGB(var(--now-button--secondary--background-color--hover,var(--now-color--neutral-3,209,214,214)),var(--now-button--secondary--background-color-alpha--hover,var(--now-button--secondary--background-color-alpha,1))); border-color:RGB(var(--now-button--secondary--border-color,var(--now-color--neutral-7,135,147,148))); border-radius:var(--now-button--secondary--border-radius,var(--now-button--border-radius,var(--now-actionable--border-radius,0))); font-family: var(--now-form-field--font-family, var(--now-font-family, \"Source Sans Pro\", Arial, sans-serif)); color:grey;");
    document.body.removeChild(document.getElementById("camButton"));
    document.getElementById("camText").value = "";
    document.body.removeChild(document.getElementById("camText"));
    document.getElementById("userText").value = "";
    document.body.removeChild(document.getElementById("userText"));
  }else{
    document.body.appendChild(camButton);
    document.body.appendChild(tenantTextBox);
    document.body.appendChild(cbuserTextBox);
  }
});

//Setting content when case is opened
ise.case.onUpdate2(
    async (receivedCaseData) => {
      if(receivedCaseData.types[0] == "nocase"){
        document.body.removeChild(document.getElementById("camButton"));
        document.getElementById("camText").value = "";
        document.body.removeChild(document.getElementById("camText"));
        document.getElementById("userText").value = "";
        document.body.removeChild(document.getElementById("userText"));
        caseData.types[0] = "nocase";
        camButton.setAttribute("style","cursor:pointer; z-index:99; display:block; position:absolute; right:162px; top:155px; vertical-align:middle; padding:5.5px 12px; background-color:RGB(var(--now-button--secondary--background-color--hover,var(--now-color--neutral-3,209,214,214)),var(--now-button--secondary--background-color-alpha--hover,var(--now-button--secondary--background-color-alpha,1))); border-color:RGB(var(--now-button--secondary--border-color,var(--now-color--neutral-7,135,147,148))); border-radius:var(--now-button--secondary--border-radius,var(--now-button--border-radius,var(--now-actionable--border-radius,0))); border-width:var(--now-button--secondary--border-width,var(--now-button--border-width,var(--now-actionable--border-width,1px))); color:RGB(var(--now-button--secondary--color,var(--now-color--neutral-18,22,27,28))); font-family: var(--now-button--font-family,var(--now-actionable--font-family,var(--now-font-family,\"Source Sans Pro\",Arial,sans-serif))); font-style:var(--now-button--font-style,var(--now-actionable--font-style,normal)); font-weight:var(--now-button--font-weight,var(--now-actionable--font-weight,normal)); font-size:1rem; line-weight:1.25;");
        tenantTextBox.setAttribute("style","z-index:99; display:block; position:absolute; width:85px; height:25px; right:395px; top:155px; background-color:RGB(var(--now-button--secondary--background-color--hover,var(--now-color--neutral-3,209,214,214)),var(--now-button--secondary--background-color-alpha--hover,var(--now-button--secondary--background-color-alpha,1))); border-color:RGB(var(--now-button--secondary--border-color,var(--now-color--neutral-7,135,147,148))); border-radius:var(--now-button--secondary--border-radius,var(--now-button--border-radius,var(--now-actionable--border-radius,0))); font-family: var(--now-form-field--font-family, var(--now-font-family, \"Source Sans Pro\", Arial, sans-serif)); color:grey;");
        cbuserTextBox.setAttribute("style","z-index:99; display:block; position:absolute; width:100px; height:25px; right:285px; top:155px; background-color:RGB(var(--now-button--secondary--background-color--hover,var(--now-color--neutral-3,209,214,214)),var(--now-button--secondary--background-color-alpha--hover,var(--now-button--secondary--background-color-alpha,1))); border-color:RGB(var(--now-button--secondary--border-color,var(--now-color--neutral-7,135,147,148))); border-radius:var(--now-button--secondary--border-radius,var(--now-button--border-radius,var(--now-actionable--border-radius,0))); font-family: var(--now-form-field--font-family, var(--now-font-family, \"Source Sans Pro\", Arial, sans-serif)); color:grey;");
      }else if (receivedCaseData.types[0] == "headers"){
        caseData = receivedCaseData;
        if(window.location.href.toString().indexOf("/record/incident") >= 0){
          camButton.setAttribute("style","cursor:pointer; z-index:99; display:block; position:absolute; right:162px; top:196px; vertical-align:middle; padding:5.5px 12px; background-color:RGB(var(--now-button--secondary--background-color--hover,var(--now-color--neutral-3,209,214,214)),var(--now-button--secondary--background-color-alpha--hover,var(--now-button--secondary--background-color-alpha,1))); border-color:RGB(var(--now-button--secondary--border-color,var(--now-color--neutral-7,135,147,148))); border-radius:var(--now-button--secondary--border-radius,var(--now-button--border-radius,var(--now-actionable--border-radius,0))); border-width:var(--now-button--secondary--border-width,var(--now-button--border-width,var(--now-actionable--border-width,1px))); color:RGB(var(--now-button--secondary--color,var(--now-color--neutral-18,22,27,28))); font-family: var(--now-button--font-family,var(--now-actionable--font-family,var(--now-font-family,\"Source Sans Pro\",Arial,sans-serif))); font-style:var(--now-button--font-style,var(--now-actionable--font-style,normal)); font-weight:var(--now-button--font-weight,var(--now-actionable--font-weight,normal)); font-size:1rem; line-weight:1.25;");
          tenantTextBox.setAttribute("style","z-index:99; display:block; position:absolute; width:85px; height:25px; right:395px; top:196px; background-color:RGB(var(--now-button--secondary--background-color--hover,var(--now-color--neutral-3,209,214,214)),var(--now-button--secondary--background-color-alpha--hover,var(--now-button--secondary--background-color-alpha,1))); border-color:RGB(var(--now-button--secondary--border-color,var(--now-color--neutral-7,135,147,148))); border-radius:var(--now-button--secondary--border-radius,var(--now-button--border-radius,var(--now-actionable--border-radius,0))); font-family: var(--now-form-field--font-family, var(--now-font-family, \"Source Sans Pro\", Arial, sans-serif)); color:grey;");
          cbuserTextBox.setAttribute("style","z-index:99; display:block; position:absolute; width:100px; height:25px; right:285px; top:196px; background-color:RGB(var(--now-button--secondary--background-color--hover,var(--now-color--neutral-3,209,214,214)),var(--now-button--secondary--background-color-alpha--hover,var(--now-button--secondary--background-color-alpha,1))); border-color:RGB(var(--now-button--secondary--border-color,var(--now-color--neutral-7,135,147,148))); border-radius:var(--now-button--secondary--border-radius,var(--now-button--border-radius,var(--now-actionable--border-radius,0))); font-family: var(--now-form-field--font-family, var(--now-font-family, \"Source Sans Pro\", Arial, sans-serif)); color:grey;");
          document.body.appendChild(camButton);
          document.body.appendChild(tenantTextBox);
        }else{
          document.body.appendChild(camButton);
          document.body.appendChild(tenantTextBox);
          document.body.appendChild(cbuserTextBox);
        }
      }      
  },
  ["headers"]);