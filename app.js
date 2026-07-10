(() => {
  "use strict";

  const STORE_KEY = "relationship.graph.builder.v1";
  const AUTH_STORE_KEY = "relationship.supabase.session.v1";
  const SVG_NS = "http://www.w3.org/2000/svg";
  const SVG_W = 1000;
  const SVG_H = 620;
  const SAGE_NETWORK_W = 1000;
  const SAGE_NETWORK_H = 760;
  const SAGE_NETWORK_NODE_R = 38;
  const SUPABASE_URL = "https://pzxlsaulqmagxbcthrcg.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_q6YhjTTRGkR8KKUFuMkWow_TexC5-h-";
  const SUPABASE_AVATAR_BUCKET = "avatars";
  const CLOUD_ENABLED = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
  const COUNTRIES = ["央", "北", "东", "西", "南"];
  const GENDERS = ["男", "女"];
  const SAGE_STATUSES = ["贤魔", "前贤魔", "非贤魔"];
  const COUNTRY_COLORS = {
    央: "#d6a21f",
    东: "#2f6fba",
    南: "#3f8f55",
    北: "#7b4db3",
    西: "#c84f45"
  };
  const CHARACTER_FIELDS = [
    ["id", "ID"],
    ["name", "姓名"],
    ["country", "国家"],
    ["gender", "性别"],
    ["sageStatus", "是否贤魔"],
    ["age", "年龄"],
    ["height", "身高cm"],
    ["birthday", "生日"],
    ["magicTool", "魔道具"],
    ["crestPosition", "纹章位置"],
    ["wounds", "伤"],
    ["manaDomain", "mana域"],
    ["magicSpecialty", "擅长的魔法"],
    ["likes", "喜欢的事/物"],
    ["dislikes", "讨厌的事/物"],
    ["strengths", "擅长的事/物"],
    ["weaknesses", "不擅长的事/物"],
    ["profile", "个人简介"]
  ];
  const RELATION_FIELDS = [
    ["id", "ID"],
    ["personAName", "人物A"],
    ["personAId", "人物A_ID"],
    ["personBName", "人物B"],
    ["personBId", "人物B_ID"],
    ["definition", "人物关系定义"],
    ["description", "人物关系描述"],
    ["viewA", "人物A对人物B看法"],
    ["viewB", "人物B对人物A看法"]
  ];
  const LAYOUT_FIELDS = [
    ["centerName", "中心人物"],
    ["centerId", "中心人物_ID"],
    ["personName", "节点人物"],
    ["personId", "节点人物_ID"],
    ["x", "X"],
    ["y", "Y"]
  ];

  const dom = {};
  let state = loadState();
  let editingPersonId = null;
  let editingRelationId = null;
  let tempAvatarData = "";
  let currentCenterId = "";
  let currentGraphPositions = {};
  let graphDirty = false;
  let toastTimer = null;
  let dragState = null;
  let dragAnimationFrame = 0;
  let pendingDragPoint = null;
  let graphElements = emptyGraphElements();
  let avatarCleared = false;
  let cloudSyncTimer = null;
  let cloudSyncInFlight = false;
  let cloudSyncAgain = false;
  let cloudReady = false;
  let authSession = loadAuthSession();
  let currentUser = authSession?.user || null;
  let selectedSageNetworkId = "";

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    cacheDom();
    bindEvents();
    await restoreAuthSession();
    resetPersonForm();
    resetRelationForm();
    renderAll();
    renderEmptyGraph("请选择中心人物生成关系图");
    await hydrateFromCloud();
  }

  function cacheDom() {
    for (const element of document.querySelectorAll("[id]")) {
      dom[element.id] = element;
    }
    dom.tabButtons = Array.from(document.querySelectorAll(".tab-button"));
    dom.tabPanels = Array.from(document.querySelectorAll(".tab-panel"));
  }

  function bindEvents() {
    dom.tabButtons.forEach((button) => {
      button.addEventListener("click", () => switchTab(button.dataset.tab));
    });

    dom.authForm.addEventListener("submit", (event) => {
      event.preventDefault();
      loginWithPassword();
    });
    dom.authLogout.addEventListener("click", logoutAuth);

    dom.personForm.addEventListener("submit", (event) => {
      event.preventDefault();
      savePersonFromForm();
    });
    dom.resetPersonForm.addEventListener("click", resetPersonForm);
    dom.personName.addEventListener("input", () => {
      if (!tempAvatarData) updateAvatarPreview();
    });
    dom.avatarInput.addEventListener("change", async () => {
      if (!requireWriteAccess()) {
        dom.avatarInput.value = "";
        return;
      }
      const file = dom.avatarInput.files[0];
      if (!file) return;
      try {
        tempAvatarData = await imageFileToDataUrl(file);
        avatarCleared = false;
        updateAvatarPreview();
      } catch (error) {
        showToast(error.message || "头像读取失败");
      } finally {
        dom.avatarInput.value = "";
      }
    });
    dom.clearAvatar.addEventListener("click", () => {
      if (!requireWriteAccess()) return;
      tempAvatarData = "";
      avatarCleared = true;
      updateAvatarPreview();
    });

    dom.peopleSearch.addEventListener("input", renderPeopleTable);
    dom.peopleCountryFilter.addEventListener("change", renderPeopleTable);
    dom.peopleGenderFilter.addEventListener("change", renderPeopleTable);
    dom.peopleSageFilter.addEventListener("change", renderPeopleTable);
    dom.peopleTableBody.addEventListener("click", onPeopleTableClick);

    dom.relationForm.addEventListener("submit", (event) => {
      event.preventDefault();
      saveRelationFromForm();
    });
    dom.resetRelationForm.addEventListener("click", resetRelationForm);
    dom.relationSearch.addEventListener("input", renderRelationsTable);
    dom.relationPersonFilter.addEventListener("change", renderRelationsTable);
    dom.relationSageFilter.addEventListener("change", renderRelationsTable);
    dom.relationsTableBody.addEventListener("click", onRelationsTableClick);

    dom.renderGraph.addEventListener("click", () => {
      currentCenterId = dom.centerPerson.value;
      renderGraph();
    });
    dom.centerPerson.addEventListener("change", () => {
      currentCenterId = dom.centerPerson.value;
      renderGraph();
    });
    dom.graphSageFilter.addEventListener("change", renderGraph);
    dom.saveGraphLayout.addEventListener("click", saveCurrentGraphLayout);
    dom.resetGraphLayout.addEventListener("click", resetCurrentGraphLayout);
    dom.exportGraphPng.addEventListener("click", exportGraphPng);
    dom.clearSageNetworkFocus.addEventListener("click", clearSageNetworkFocus);
    dom.sageNetworkGraph.addEventListener("click", clearSageNetworkFocus);

    dom.exportAllJson.addEventListener("click", () => exportJson("all"));
    dom.exportPeopleJson.addEventListener("click", () => exportJson("people"));
    dom.exportRelationsJson.addEventListener("click", () => exportJson("relations"));
    dom.exportAllExcel.addEventListener("click", () => exportExcel("all"));
    dom.exportPeopleExcel.addEventListener("click", () => exportExcel("people"));
    dom.exportRelationsExcel.addEventListener("click", () => exportExcel("relations"));

    bindFileImport(dom.importAllFile, "all");
    bindFileImport(dom.importPeopleFile, "people");
    bindFileImport(dom.importRelationsFile, "relations");
    bindFileImport(dom.importGraphFile, "all");
  }

  function bindFileImport(input, scope) {
    input.addEventListener("change", async () => {
      if (!requireWriteAccess()) {
        input.value = "";
        return;
      }
      const file = input.files[0];
      if (!file) return;
      try {
        await importFile(file, scope);
      } catch (error) {
        showToast(error.message || "导入失败");
      } finally {
        input.value = "";
      }
    });
  }

  function switchTab(tab) {
    dom.tabButtons.forEach((button) => {
      button.classList.toggle("active", button.dataset.tab === tab);
    });
    dom.tabPanels.forEach((panel) => {
      panel.classList.toggle("active", panel.id === `${tab}Panel`);
    });
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return emptyState();
      const parsed = JSON.parse(raw);
      return {
        characters: Array.isArray(parsed.characters) ? parsed.characters : [],
        relationships: Array.isArray(parsed.relationships) ? parsed.relationships : [],
        layouts: parsed.layouts && typeof parsed.layouts === "object" ? parsed.layouts : {},
        updatedAt: parsed.updatedAt || ""
      };
    } catch {
      return emptyState();
    }
  }

  function emptyState() {
    return {
      characters: [],
      relationships: [],
      layouts: {},
      updatedAt: ""
    };
  }

  function emptyGraphElements() {
    return {
      nodes: new Map(),
      links: [],
      labels: []
    };
  }

  function saveState(options = {}) {
    const { syncCloud = true } = options;
    state.updatedAt = new Date().toISOString();
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (error) {
      throw new Error("本地存储空间不足。请优先导出 JSON 备份，或减少头像图片数量。");
    }
    if (syncCloud) scheduleCloudSync();
  }

  function renderAll() {
    renderPeopleTable();
    renderPersonSelects();
    renderRelationsTable();
    renderGraphSelect();
    if (currentCenterId) renderGraph();
    renderSageNetwork();
    updateAuthUi();
  }

  function loadAuthSession() {
    try {
      const raw = localStorage.getItem(AUTH_STORE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function saveAuthSession(session) {
    authSession = session;
    currentUser = session?.user || null;
    try {
      if (session) {
        localStorage.setItem(AUTH_STORE_KEY, JSON.stringify(session));
      } else {
        localStorage.removeItem(AUTH_STORE_KEY);
      }
    } catch {
      // Auth still works for the current tab even if localStorage is unavailable.
    }
  }

  function normalizeAuthSession(payload) {
    if (!payload?.access_token) return null;
    const now = Math.floor(Date.now() / 1000);
    return {
      access_token: payload.access_token,
      refresh_token: payload.refresh_token || authSession?.refresh_token || "",
      token_type: payload.token_type || "bearer",
      expires_at: payload.expires_at || now + Number(payload.expires_in || 3600),
      user: payload.user || authSession?.user || null
    };
  }

  function authToken() {
    return authSession?.access_token || SUPABASE_PUBLISHABLE_KEY;
  }

  function canWriteCloud() {
    return CLOUD_ENABLED && Boolean(authSession?.access_token && currentUser?.id);
  }

  function requireWriteAccess() {
    if (canWriteCloud()) return true;
    showToast("请先登录后再修改云端数据。");
    return false;
  }

  function isAuthExpiringSoon(session) {
    return !session?.access_token || Number(session.expires_at || 0) * 1000 < Date.now() + 60000;
  }

  async function restoreAuthSession() {
    if (!authSession) {
      updateAuthUi();
      return;
    }
    currentUser = authSession.user || null;
    updateAuthUi();
    if (!isAuthExpiringSoon(authSession)) return;
    try {
      await refreshAuthSession();
    } catch {
      saveAuthSession(null);
      updateAuthUi();
      showToast("登录已过期，请重新登录。");
    }
  }

  async function refreshAuthSession() {
    if (!authSession?.refresh_token) throw new Error("Missing refresh token");
    const payload = await authRequest("token?grant_type=refresh_token", {
      method: "POST",
      body: JSON.stringify({ refresh_token: authSession.refresh_token })
    });
    const session = normalizeAuthSession(payload);
    if (!session) throw new Error("Invalid auth session");
    saveAuthSession(session);
    updateAuthUi();
  }

  async function loginWithPassword() {
    if (!CLOUD_ENABLED) {
      showToast("尚未配置 Supabase，无法登录。");
      return;
    }
    const email = dom.authEmail.value.trim();
    const password = dom.authPassword.value;
    if (!email || !password) {
      showToast("请填写邮箱和密码。");
      return;
    }
    dom.authLogin.disabled = true;
    try {
      const payload = await authRequest("token?grant_type=password", {
        method: "POST",
        body: JSON.stringify({ email, password })
      });
      const session = normalizeAuthSession(payload);
      if (!session) throw new Error("Invalid auth session");
      saveAuthSession(session);
      dom.authPassword.value = "";
      renderAll();
      scheduleCloudSync();
      showToast("已登录，可以编辑云端数据。");
    } catch (error) {
      showToast(`登录失败：${shortError(error)}`);
    } finally {
      dom.authLogin.disabled = false;
      updateAuthUi();
    }
  }

  async function logoutAuth() {
    const token = authSession?.access_token;
    saveAuthSession(null);
    renderAll();
    showToast("已退出登录，当前为只读模式。");
    if (!token) return;
    try {
      await authRequest("logout", {
        method: "POST",
        accessToken: token
      });
    } catch {
      // Local logout is enough for this static app.
    }
  }

  async function authRequest(path, options = {}) {
    const { accessToken, headers: optionHeaders, ...fetchOptions } = options;
    const headers = {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(optionHeaders || {})
    };
    const response = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
      ...fetchOptions,
      headers
    });
    if (!response.ok) throw new Error(await response.text());
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  function updateAuthUi() {
    if (!dom.authStatus) return;
    const signedIn = canWriteCloud();
    dom.authStatus.textContent = signedIn
      ? `已登录：${currentUser.email || currentUser.id}`
      : "未登录：只读模式";
    dom.authEmail.hidden = signedIn;
    dom.authPassword.hidden = signedIn;
    dom.authLogin.hidden = signedIn;
    dom.authLogout.hidden = !signedIn;
    setWriteControlsDisabled(!signedIn);
  }

  function setWriteControlsDisabled(disabled) {
    const selectors = [
      "#personForm input",
      "#personForm select",
      "#personForm textarea",
      "#personForm button",
      "#relationForm input",
      "#relationForm select",
      "#relationForm textarea",
      "#relationForm button",
      "#importAllFile",
      "#importPeopleFile",
      "#importRelationsFile",
      "#importGraphFile",
      "#saveGraphLayout",
      "#resetGraphLayout",
      ".row-actions button"
    ];
    document.querySelectorAll(selectors.join(",")).forEach((element) => {
      element.disabled = disabled;
    });
    [dom.avatarInput, dom.importAllFile, dom.importPeopleFile, dom.importRelationsFile, dom.importGraphFile]
      .filter(Boolean)
      .forEach((input) => {
        input.closest(".file-button")?.classList.toggle("disabled", disabled);
      });
  }

  async function hydrateFromCloud() {
    if (!CLOUD_ENABLED) return;
    try {
      const cloudState = await fetchCloudState();
      const hasCloudData =
        cloudState.characters.length ||
        cloudState.relationships.length ||
        Object.keys(cloudState.layouts).length;
      if (hasCloudData) {
        state = cloudState;
        cloudReady = true;
        saveState({ syncCloud: false });
        renderAll();
        if (currentCenterId) renderGraph();
        showToast("已连接 Supabase 云端库");
        return;
      }
      cloudReady = true;
      if (canWriteCloud() && (state.characters.length || state.relationships.length || Object.keys(state.layouts).length)) {
        scheduleCloudSync();
        showToast("云端库为空，正在上传本地数据");
      } else if (state.characters.length || state.relationships.length || Object.keys(state.layouts).length) {
        showToast("云端库为空。本地数据需登录后才能上传。");
      } else {
        showToast("已连接 Supabase 云端库");
      }
    } catch (error) {
      cloudReady = false;
      showToast(`云端读取失败，继续使用本地库：${shortError(error)}`);
    }
  }

  async function fetchCloudState() {
    const [charactersRows, relationshipRows, layoutRows] = await Promise.all([
      cloudRequest("characters?select=*"),
      cloudRequest("relationships?select=*"),
      cloudRequest("graph_layouts?select=*")
    ]);
    const layouts = {};
    for (const row of layoutRows || []) {
      if (!layouts[row.center_id]) {
        layouts[row.center_id] = {
          positions: {},
          updatedAt: row.updated_at || ""
        };
      }
      layouts[row.center_id].positions[row.person_id] = {
        x: Number(row.x),
        y: Number(row.y)
      };
      if (row.updated_at) layouts[row.center_id].updatedAt = row.updated_at;
    }
    return {
      characters: (charactersRows || []).map(rowToCharacter),
      relationships: (relationshipRows || []).map(rowToRelation),
      layouts,
      updatedAt: new Date().toISOString()
    };
  }

  function scheduleCloudSync() {
    if (!CLOUD_ENABLED || !canWriteCloud()) return;
    clearTimeout(cloudSyncTimer);
    cloudSyncTimer = setTimeout(() => {
      syncStateToCloud().catch((error) => {
        showToast(`云端同步失败：${shortError(error)}`);
      });
    }, cloudReady ? 500 : 1200);
  }

  async function syncStateToCloud() {
    if (!CLOUD_ENABLED || !canWriteCloud()) return;
    if (cloudSyncInFlight) {
      cloudSyncAgain = true;
      return;
    }
    cloudSyncInFlight = true;
    try {
      await uploadPendingAvatars();
      await upsertCloudRows("characters", state.characters.map(characterToRow), "id");
      await upsertCloudRows("relationships", state.relationships.map(relationToRow), "id");
      await upsertCloudRows("graph_layouts", layoutsToCloudRows(), "center_id,person_id");
      saveState({ syncCloud: false });
      cloudReady = true;
    } finally {
      cloudSyncInFlight = false;
      if (cloudSyncAgain) {
        cloudSyncAgain = false;
        scheduleCloudSync();
      }
    }
  }

  async function upsertCloudRows(table, rows, onConflict) {
    if (!rows.length) return;
    await cloudRequest(`${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify(rows)
    });
  }

  async function deleteCloudRows(table, filter) {
    if (!CLOUD_ENABLED || !canWriteCloud()) return;
    try {
      await cloudRequest(`${table}?${filter}`, {
        method: "DELETE",
        headers: {
          Prefer: "return=minimal"
        }
      });
    } catch (error) {
      showToast(`云端删除失败：${shortError(error)}`);
    }
  }

  async function cloudRequest(path, options = {}) {
    const headers = {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${authToken()}`,
      ...(options.headers || {})
    };
    if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      ...options,
      headers
    });
    if (!response.ok) throw new Error(await response.text());
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  function rowToCharacter(row) {
    return {
      id: row.id,
      name: row.name || "",
      avatarData: "",
      avatarPath: row.avatar_path || "",
      avatarUrl: row.avatar_url || "",
      country: row.country || "",
      gender: row.gender || "",
      sageStatus: normalizeSageStatus(row.sage_status),
      age: row.age ?? "",
      height: row.height ?? "",
      birthday: row.birthday || "",
      magicTool: row.magic_tool || "",
      crestPosition: row.crest_position || "",
      wounds: row.wounds || "",
      manaDomain: row.mana_domain || "",
      magicSpecialty: row.magic_specialty || "",
      likes: row.likes || "",
      dislikes: row.dislikes || "",
      strengths: row.strengths || "",
      weaknesses: row.weaknesses || "",
      profile: row.profile || "",
      createdAt: row.created_at || "",
      updatedAt: row.updated_at || ""
    };
  }

  function characterToRow(character) {
    return {
      id: character.id,
      name: character.name,
      avatar_path: character.avatarPath || null,
      avatar_url: character.avatarUrl || null,
      country: character.country,
      gender: character.gender,
      sage_status: normalizeSageStatus(character.sageStatus),
      age: Number(character.age),
      height: character.height === "" || character.height === undefined ? null : Number(character.height),
      birthday: emptyToNull(character.birthday),
      magic_tool: emptyToNull(character.magicTool),
      crest_position: emptyToNull(character.crestPosition),
      wounds: emptyToNull(character.wounds),
      mana_domain: emptyToNull(character.manaDomain),
      magic_specialty: emptyToNull(character.magicSpecialty),
      likes: emptyToNull(character.likes),
      dislikes: emptyToNull(character.dislikes),
      strengths: emptyToNull(character.strengths),
      weaknesses: emptyToNull(character.weaknesses),
      profile: emptyToNull(character.profile),
      created_at: character.createdAt || new Date().toISOString(),
      updated_at: character.updatedAt || new Date().toISOString()
    };
  }

  function rowToRelation(row) {
    return {
      id: row.id,
      personAId: row.person_a_id,
      personBId: row.person_b_id,
      definition: row.definition || "",
      description: row.description || "",
      viewA: row.view_a || "",
      viewB: row.view_b || "",
      createdAt: row.created_at || "",
      updatedAt: row.updated_at || ""
    };
  }

  function relationToRow(relation) {
    return {
      id: relation.id,
      person_a_id: relation.personAId,
      person_b_id: relation.personBId,
      definition: relation.definition,
      description: emptyToNull(relation.description),
      view_a: emptyToNull(relation.viewA),
      view_b: emptyToNull(relation.viewB),
      created_at: relation.createdAt || new Date().toISOString(),
      updated_at: relation.updatedAt || new Date().toISOString()
    };
  }

  function layoutsToCloudRows() {
    const rows = [];
    for (const [centerId, layout] of Object.entries(state.layouts)) {
      for (const [personId, position] of Object.entries(layout.positions || {})) {
        if (!findPerson(centerId) || !findPerson(personId)) continue;
        rows.push({
          center_id: centerId,
          person_id: personId,
          x: round2(Number(position.x)),
          y: round2(Number(position.y)),
          updated_at: layout.updatedAt || new Date().toISOString()
        });
      }
    }
    return rows;
  }

  function emptyToNull(value) {
    const text = String(value ?? "").trim();
    return text ? text : null;
  }

  async function uploadPendingAvatars() {
    if (!canWriteCloud()) return;
    for (const character of state.characters) {
      if (!isDataImage(character.avatarData)) continue;
      const { blob, extension } = dataUrlToBlob(character.avatarData);
      const path = `${character.id}.${extension}`;
      const response = await fetch(
        `${SUPABASE_URL}/storage/v1/object/${SUPABASE_AVATAR_BUCKET}/${encodeURIComponent(path)}`,
        {
          method: "POST",
          headers: {
            apikey: SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${authToken()}`,
            "Content-Type": blob.type || "application/octet-stream",
            "x-upsert": "true"
          },
          body: blob
        }
      );
      if (!response.ok) throw new Error(await response.text());
      character.avatarPath = path;
      character.avatarUrl = `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_AVATAR_BUCKET}/${encodeURIComponent(path)}?v=${Date.now()}`;
      character.avatarData = "";
      character.updatedAt = new Date().toISOString();
    }
  }

  function dataUrlToBlob(dataUrl) {
    const match = String(dataUrl || "").match(/^data:([^;,]+)(;base64)?,(.*)$/);
    if (!match) throw new Error("头像数据格式不正确");
    const mimeType = match[1] || "application/octet-stream";
    const content = match[3] || "";
    const binary = match[2] ? atob(content) : decodeURIComponent(content);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return {
      blob: new Blob([bytes], { type: mimeType }),
      extension: imageExtension(mimeType)
    };
  }

  function imageExtension(mimeType) {
    if (mimeType === "image/png") return "png";
    if (mimeType === "image/webp") return "webp";
    if (mimeType === "image/gif") return "gif";
    return "jpg";
  }

  function shortError(error) {
    return String(error?.message || error || "未知错误").slice(0, 180);
  }

  function resetPersonForm() {
    editingPersonId = null;
    tempAvatarData = "";
    avatarCleared = false;
    dom.personForm.reset();
    dom.sageStatus.value = "非贤魔";
    dom.personFormTitle.textContent = "新建人物";
    updateAvatarPreview();
  }

  function updateAvatarPreview() {
    const existing = editingPersonId ? findPerson(editingPersonId) : null;
    dom.avatarPreview.src =
      tempAvatarData || (!avatarCleared && existing?.avatarUrl) || defaultAvatar(dom.personName.value.trim());
  }

  function savePersonFromForm() {
    if (!requireWriteAccess()) return;
    try {
      const person = collectPersonForm();
      const duplicate = state.characters.find(
        (item) => item.name === person.name && item.id !== person.id
      );
      if (duplicate) {
        throw new Error("姓名已存在。为了关系导入和选择准确，人物姓名需保持唯一。");
      }

      const existingIndex = state.characters.findIndex((item) => item.id === person.id);
      if (existingIndex >= 0) {
        state.characters[existingIndex] = {
          ...state.characters[existingIndex],
          ...person,
          updatedAt: new Date().toISOString()
        };
      } else {
        state.characters.push({
          ...person,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }
      saveState();
      resetPersonForm();
      renderAll();
      showToast("人物已保存");
    } catch (error) {
      showToast(error.message);
    }
  }

  function collectPersonForm() {
    const previous = editingPersonId
      ? state.characters.find((item) => item.id === editingPersonId)
      : null;
    const name = dom.personName.value.trim();
    const country = dom.country.value;
    const gender = dom.gender.value;
    const sageStatus = normalizeSageStatus(dom.sageStatus.value);
    const age = normalizeAge(dom.age.value);
    const height = normalizeOptionalHeight(dom.height.value);
    const birthday = normalizeOptionalBirthday(dom.birthdayMonth.value, dom.birthdayDay.value);
    const magicTool = dom.magicTool.value.trim();
    const manaDomain = dom.manaDomain.value.trim();

    if (!name) throw new Error("请填写姓名");
    if (!COUNTRIES.includes(country)) throw new Error("请选择国家");
    if (!GENDERS.includes(gender)) throw new Error("请选择性别");
    if (manaDomain.length > 10) throw new Error("mana 域不能超过 10 字");
    const avatarFields = collectAvatarFields(previous);

    return {
      id: previous ? previous.id : createId("char"),
      name,
      ...avatarFields,
      country,
      gender,
      sageStatus,
      age,
      height,
      birthday,
      magicTool,
      crestPosition: dom.crestPosition.value.trim(),
      wounds: dom.wounds.value.trim(),
      manaDomain,
      magicSpecialty: dom.magicSpecialty.value.trim(),
      likes: dom.likes.value.trim(),
      dislikes: dom.dislikes.value.trim(),
      strengths: dom.strengths.value.trim(),
      weaknesses: dom.weaknesses.value.trim(),
      profile: dom.profile.value.trim()
    };
  }

  function collectAvatarFields(previous) {
    if (avatarCleared) {
      return {
        avatarData: "",
        avatarPath: "",
        avatarUrl: ""
      };
    }
    if (isDataImage(tempAvatarData)) {
      return {
        avatarData: tempAvatarData,
        avatarPath: "",
        avatarUrl: ""
      };
    }
    return {
      avatarData: previous?.avatarData || "",
      avatarPath: previous?.avatarPath || "",
      avatarUrl: previous?.avatarUrl || ""
    };
  }

  function normalizeAge(value) {
    if (value === "" || value === null || value === undefined) {
      throw new Error("年龄需为 0 到 9999 之间的整数");
    }
    const number = Number(String(value).trim().replace(/[+＋]$/, ""));
    if (!Number.isInteger(number) || number < 0 || number > 9999) {
      throw new Error("年龄需为 0 到 9999 之间的整数");
    }
    return number < 100 ? number : Math.floor(number / 100) * 100;
  }

  function normalizeHeight(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0 || number > 999) {
      throw new Error("身高需为 1 到 999 cm 之间的数字");
    }
    return Math.round(number);
  }

  function normalizeOptionalHeight(value) {
    if (value === "" || value === null || value === undefined) return "";
    return normalizeHeight(value);
  }

  function normalizeBirthday(monthValue, dayValue) {
    const month = Number(monthValue);
    const day = Number(dayValue);
    if (!Number.isInteger(month) || !Number.isInteger(day)) {
      throw new Error("生日需填写月份和日期");
    }
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      throw new Error("生日月份或日期不合法");
    }
    const date = new Date(2024, month - 1, day);
    if (date.getMonth() !== month - 1 || date.getDate() !== day) {
      throw new Error("生日日期不存在");
    }
    return `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function parseBirthdayText(value, monthValue, dayValue) {
    if (monthValue || dayValue) return normalizeBirthday(monthValue, dayValue);
    const text = String(value || "").trim();
    const match = text.match(/(\d{1,2})\s*[-/.月]\s*(\d{1,2})/);
    if (!match) throw new Error("生日需使用 MM-DD 格式");
    return normalizeBirthday(match[1], match[2]);
  }

  function normalizeOptionalBirthday(monthValue, dayValue) {
    if (!monthValue && !dayValue) return "";
    return normalizeBirthday(monthValue, dayValue);
  }

  function parseOptionalBirthdayText(value, monthValue, dayValue) {
    if (monthValue || dayValue) return normalizeBirthday(monthValue, dayValue);
    if (!String(value || "").trim()) return "";
    return parseBirthdayText(value, monthValue, dayValue);
  }

  function normalizeSageStatus(value) {
    const text = String(value ?? "").trim();
    if (!text) return "非贤魔";
    if (!SAGE_STATUSES.includes(text)) {
      throw new Error("是否贤魔只能选择：贤魔、前贤魔、非贤魔");
    }
    return text;
  }

  function renderPeopleTable() {
    const search = dom.peopleSearch.value.trim().toLowerCase();
    const country = dom.peopleCountryFilter.value;
    const gender = dom.peopleGenderFilter.value;
    const sageStatus = dom.peopleSageFilter.value;
    const writeDisabled = canWriteCloud() ? "" : " disabled";
    const filtered = state.characters.filter((person) => {
      if (country && person.country !== country) return false;
      if (gender && person.gender !== gender) return false;
      if (sageStatus && normalizeSageStatus(person.sageStatus) !== sageStatus) return false;
      if (!search) return true;
      return characterSearchText(person).toLowerCase().includes(search);
    });

    dom.peopleCount.textContent = `${state.characters.length} 人`;
    dom.peopleTableBody.innerHTML = filtered.length
      ? filtered
          .map(
            (person) => `
            <tr>
              <td><img class="mini-avatar" src="${escapeAttr(avatarFor(person))}" alt="${escapeAttr(person.name)}"></td>
              <td>${escapeHtml(person.name)}</td>
              <td>${escapeHtml(person.country)}</td>
              <td>${escapeHtml(person.gender)}</td>
              <td>${escapeHtml(normalizeSageStatus(person.sageStatus))}</td>
              <td>${escapeHtml(String(person.age))}</td>
              <td>${person.height === "" || person.height === undefined ? "" : `${escapeHtml(String(person.height))} cm`}</td>
              <td>${escapeHtml(person.birthday)}</td>
              <td class="muted-cell" title="${escapeAttr(person.magicTool)}">${escapeHtml(person.magicTool)}</td>
              <td>
                <div class="row-actions">
                  <button class="small-button" data-action="edit" data-id="${escapeAttr(person.id)}" type="button"${writeDisabled}>编辑</button>
                  <button class="small-button danger-button" data-action="delete" data-id="${escapeAttr(person.id)}" type="button"${writeDisabled}>删除</button>
                </div>
              </td>
            </tr>`
          )
          .join("")
      : `<tr><td colspan="10">暂无人物，先在左侧新建。</td></tr>`;
  }

  function characterSearchText(person) {
    return [
      person.name,
      person.country,
      person.gender,
      normalizeSageStatus(person.sageStatus),
      person.magicTool,
      person.crestPosition,
      person.wounds,
      person.manaDomain,
      person.magicSpecialty,
      person.likes,
      person.dislikes,
      person.strengths,
      person.weaknesses,
      person.profile
    ]
      .filter(Boolean)
      .join(" ");
  }

  function onPeopleTableClick(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    if (!requireWriteAccess()) return;
    const id = button.dataset.id;
    if (button.dataset.action === "edit") loadPersonIntoForm(id);
    if (button.dataset.action === "delete") deletePerson(id);
  }

  function loadPersonIntoForm(id) {
    const person = findPerson(id);
    if (!person) return;
    editingPersonId = person.id;
    tempAvatarData = person.avatarData || "";
    avatarCleared = false;
    dom.personFormTitle.textContent = `编辑人物：${person.name}`;
    dom.personName.value = person.name || "";
    dom.country.value = person.country || "";
    dom.gender.value = person.gender || "";
    dom.sageStatus.value = normalizeSageStatus(person.sageStatus);
    dom.age.value = person.age ?? "";
    dom.height.value = person.height ?? "";
    const [month, day] = String(person.birthday || "").split("-");
    dom.birthdayMonth.value = Number(month) || "";
    dom.birthdayDay.value = Number(day) || "";
    dom.magicTool.value = person.magicTool || "";
    dom.crestPosition.value = person.crestPosition || "";
    dom.wounds.value = person.wounds || "";
    dom.manaDomain.value = person.manaDomain || "";
    dom.magicSpecialty.value = person.magicSpecialty || "";
    dom.likes.value = person.likes || "";
    dom.dislikes.value = person.dislikes || "";
    dom.strengths.value = person.strengths || "";
    dom.weaknesses.value = person.weaknesses || "";
    dom.profile.value = person.profile || "";
    updateAvatarPreview();
    dom.personForm.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function deletePerson(id) {
    if (!requireWriteAccess()) return;
    const person = findPerson(id);
    if (!person) return;
    const related = state.relationships.filter((relation) => relation.personAId === id || relation.personBId === id);
    const message = related.length
      ? `删除「${person.name}」会同时删除 ${related.length} 条相关关系，并清除相关图谱布局。是否继续？`
      : `确认删除「${person.name}」？`;
    if (!confirm(message)) return;

    state.characters = state.characters.filter((item) => item.id !== id);
    state.relationships = state.relationships.filter(
      (relation) => relation.personAId !== id && relation.personBId !== id
    );
    for (const centerId of Object.keys(state.layouts)) {
      if (centerId === id) {
        delete state.layouts[centerId];
      } else if (state.layouts[centerId]?.positions) {
        delete state.layouts[centerId].positions[id];
      }
    }
    if (editingPersonId === id) resetPersonForm();
    if (editingRelationId && !state.relationships.some((item) => item.id === editingRelationId)) {
      resetRelationForm();
    }
    if (currentCenterId === id) {
      currentCenterId = "";
      renderEmptyGraph("请选择中心人物生成关系图");
    }
    saveState();
    deleteCloudRows("characters", `id=eq.${encodeURIComponent(id)}`);
    renderAll();
    showToast("人物及相关关系已删除");
  }

  function renderPersonSelects() {
    fillPersonSelect(dom.personA, "请选择人物 A", dom.personA.value);
    fillPersonSelect(dom.personB, "请选择人物 B", dom.personB.value);
    fillPersonSelect(dom.relationPersonFilter, "全部人物", dom.relationPersonFilter.value, true);
  }

  function fillPersonSelect(select, placeholder, selectedValue, allowEmpty = false) {
    const options = [];
    options.push(`<option value="">${escapeHtml(placeholder)}</option>`);
    for (const person of state.characters) {
      options.push(
        `<option value="${escapeAttr(person.id)}">${escapeHtml(person.name)}（${escapeHtml(person.country)}）</option>`
      );
    }
    select.innerHTML = options.join("");
    if (selectedValue && state.characters.some((person) => person.id === selectedValue)) {
      select.value = selectedValue;
    } else if (!allowEmpty && !selectedValue) {
      select.value = "";
    }
  }

  function resetRelationForm() {
    editingRelationId = null;
    dom.relationForm.reset();
    dom.relationFormTitle.textContent = "新建关系";
    renderPersonSelects();
  }

  function saveRelationFromForm() {
    if (!requireWriteAccess()) return;
    try {
      const relation = collectRelationForm();
      const existing = state.relationships.find(
        (item) => samePair(item.personAId, item.personBId, relation.personAId, relation.personBId) && item.id !== relation.id
      );
      if (existing) {
        const nameA = findPerson(relation.personAId)?.name || "人物 A";
        const nameB = findPerson(relation.personBId)?.name || "人物 B";
        if (!confirm(`「${nameA}」与「${nameB}」已有一行关系。是否更新这行关系？`)) return;
        Object.assign(existing, {
          personAId: relation.personAId,
          personBId: relation.personBId,
          definition: relation.definition,
          description: relation.description,
          viewA: relation.viewA,
          viewB: relation.viewB,
          updatedAt: new Date().toISOString()
        });
      } else {
        const index = state.relationships.findIndex((item) => item.id === relation.id);
        if (index >= 0) {
          state.relationships[index] = {
            ...state.relationships[index],
            ...relation,
            updatedAt: new Date().toISOString()
          };
        } else {
          state.relationships.push({
            ...relation,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
        }
      }
      saveState();
      resetRelationForm();
      renderAll();
      showToast("关系已保存");
    } catch (error) {
      showToast(error.message);
    }
  }

  function collectRelationForm() {
    const previous = editingRelationId
      ? state.relationships.find((item) => item.id === editingRelationId)
      : null;
    const personAId = dom.personA.value;
    const personBId = dom.personB.value;
    if (!personAId || !personBId) throw new Error("请选择人物 A 和人物 B");
    if (personAId === personBId) throw new Error("人物 A 和人物 B 不能相同");
    if (!findPerson(personAId) || !findPerson(personBId)) throw new Error("人物不存在，请刷新选择");

    const definition = normalizeRelationDefinition(dom.relationDefinition.value);
    return {
      id: previous ? previous.id : createId("rel"),
      personAId,
      personBId,
      definition,
      description: dom.relationDescription.value.trim(),
      viewA: dom.viewA.value.trim(),
      viewB: dom.viewB.value.trim()
    };
  }

  function normalizeRelationDefinition(value) {
    const parts = String(value || "")
      .split(/[、,，;；/／\n]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (!parts.length) throw new Error("请填写人物关系定义");
    const tooLong = parts.find((item) => charLength(item) > 10);
    if (tooLong) throw new Error(`关系定义「${tooLong}」超过 10 字`);
    return unique(parts).join("、");
  }

  function renderRelationsTable() {
    const search = dom.relationSearch.value.trim().toLowerCase();
    const personFilter = dom.relationPersonFilter.value;
    const sageFilter = selectedSageStatusSet(dom.relationSageFilter);
    const writeDisabled = canWriteCloud() ? "" : " disabled";
    const filtered = state.relationships.filter((relation) => {
      if (
        personFilter &&
        relation.personAId !== personFilter &&
        relation.personBId !== personFilter
      ) {
        return false;
      }
      if (!relationMatchesSageFilter(relation, sageFilter, personFilter)) return false;
      if (!search) return true;
      return relationSearchText(relation).toLowerCase().includes(search);
    });

    dom.relationsCount.textContent =
      filtered.length === state.relationships.length
        ? `${state.relationships.length} 条`
        : `${filtered.length} / ${state.relationships.length} 条`;
    dom.relationsTableBody.innerHTML = filtered.length
      ? filtered
          .map((relation) => {
            const personA = findPerson(relation.personAId);
            const personB = findPerson(relation.personBId);
            return `
              <tr>
                <td>${escapeHtml(personA?.name || "已删除人物")}</td>
                <td>${escapeHtml(personB?.name || "已删除人物")}</td>
                <td>${definitionTagsHtml(relation.definition)}</td>
                <td class="muted-cell" title="${escapeAttr(relation.description || "")}">${escapeHtml(relation.description || "未填写")}</td>
                <td>
                  <div class="row-actions">
                    <button class="small-button" data-action="edit" data-id="${escapeAttr(relation.id)}" type="button"${writeDisabled}>编辑</button>
                    <button class="small-button danger-button" data-action="delete" data-id="${escapeAttr(relation.id)}" type="button"${writeDisabled}>删除</button>
                  </div>
                </td>
              </tr>`;
          })
          .join("")
      : `<tr><td colspan="5">暂无关系，先在左侧新建。</td></tr>`;
  }

  function relationSearchText(relation) {
    const personA = findPerson(relation.personAId);
    const personB = findPerson(relation.personBId);
    return [
      personA?.name,
      personB?.name,
      relation.definition,
      relation.description,
      relation.viewA,
      relation.viewB
    ]
      .filter(Boolean)
      .join(" ");
  }

  function selectedSageStatusSet(container) {
    if (!container) return null;
    const selected = Array.from(container.querySelectorAll("input[type='checkbox']:checked"))
      .map((input) => input.value)
      .filter((value) => SAGE_STATUSES.includes(value));
    if (selected.length === SAGE_STATUSES.length) return null;
    return new Set(selected);
  }

  function relationMatchesSageFilter(relation, sageFilter, anchorPersonId = "") {
    if (!sageFilter) return true;
    const people = [];
    if (anchorPersonId) {
      if (relation.personAId === anchorPersonId) people.push(findPerson(relation.personBId));
      if (relation.personBId === anchorPersonId) people.push(findPerson(relation.personAId));
    } else {
      people.push(findPerson(relation.personAId), findPerson(relation.personBId));
    }
    return people.some((person) => person && sageFilter.has(normalizeSageStatus(person.sageStatus)));
  }

  function definitionTagsHtml(definition) {
    return `<div class="definition-tags">${String(definition || "")
      .split("、")
      .filter(Boolean)
      .map((item) => `<span class="definition-tag">${escapeHtml(item)}</span>`)
      .join("")}</div>`;
  }

  function onRelationsTableClick(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    if (!requireWriteAccess()) return;
    const id = button.dataset.id;
    if (button.dataset.action === "edit") loadRelationIntoForm(id);
    if (button.dataset.action === "delete") deleteRelation(id);
  }

  function loadRelationIntoForm(id) {
    const relation = state.relationships.find((item) => item.id === id);
    if (!relation) return;
    editingRelationId = id;
    renderPersonSelects();
    dom.relationFormTitle.textContent = "编辑关系";
    dom.personA.value = relation.personAId;
    dom.personB.value = relation.personBId;
    dom.relationDefinition.value = relation.definition || "";
    dom.relationDescription.value = relation.description || "";
    dom.viewA.value = relation.viewA || "";
    dom.viewB.value = relation.viewB || "";
    dom.relationForm.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function deleteRelation(id) {
    if (!requireWriteAccess()) return;
    const relation = state.relationships.find((item) => item.id === id);
    if (!relation) return;
    const personA = findPerson(relation.personAId)?.name || "人物 A";
    const personB = findPerson(relation.personBId)?.name || "人物 B";
    if (!confirm(`确认删除「${personA}」与「${personB}」的关系？`)) return;
    state.relationships = state.relationships.filter((item) => item.id !== id);
    if (editingRelationId === id) resetRelationForm();
    saveState();
    deleteCloudRows("relationships", `id=eq.${encodeURIComponent(id)}`);
    renderAll();
    showToast("关系已删除");
  }

  function renderGraphSelect() {
    const previous = currentCenterId || dom.centerPerson.value;
    fillPersonSelect(dom.centerPerson, "请选择中心人物", previous);
    if (previous && state.characters.some((person) => person.id === previous)) {
      dom.centerPerson.value = previous;
      currentCenterId = previous;
    }
  }

  function renderGraph() {
    const centerId = currentCenterId || dom.centerPerson.value;
    if (!centerId) {
      renderEmptyGraph("请选择中心人物生成关系图");
      return;
    }
    const center = findPerson(centerId);
    if (!center) {
      renderEmptyGraph("中心人物不存在");
      return;
    }

    const relatedRelations = filteredGraphRelations(centerId);
    if (!relatedRelations.length) {
      currentGraphPositions = {};
      graphDirty = false;
      renderGraphSvg(center, [], {});
      dom.graphStatus.textContent = "暂无符合筛选的相关关系";
      return;
    }

    const otherIds = relatedRelations.map((relation) =>
      relation.personAId === centerId ? relation.personBId : relation.personAId
    );
    const uniqueOtherIds = unique(otherIds).filter((id) => findPerson(id));
    currentGraphPositions = buildGraphPositions(centerId, uniqueOtherIds);
    graphDirty = false;
    renderGraphSvg(center, relatedRelations, currentGraphPositions);
    dom.graphStatus.textContent = `${relatedRelations.length} 条关系`;
  }

  function filteredGraphRelations(centerId) {
    const sageFilter = selectedSageStatusSet(dom.graphSageFilter);
    return state.relationships.filter((relation) => {
      if (relation.personAId !== centerId && relation.personBId !== centerId) return false;
      const otherId = relation.personAId === centerId ? relation.personBId : relation.personAId;
      const other = findPerson(otherId);
      return !sageFilter || (other && sageFilter.has(normalizeSageStatus(other.sageStatus)));
    });
  }

  function buildGraphPositions(centerId, otherIds) {
    const saved = state.layouts[centerId]?.positions || {};
    const positions = {};
    const count = Math.max(otherIds.length, 1);
    otherIds.forEach((id, index) => {
      if (saved[id] && Number.isFinite(Number(saved[id].x)) && Number.isFinite(Number(saved[id].y))) {
        positions[id] = {
          x: clamp(Number(saved[id].x), 8, 92),
          y: clamp(Number(saved[id].y), 10, 90)
        };
        return;
      }
      const angle = otherIds.length === 1 ? 0 : -90 + ((index * 137.508) % 360);
      const radians = (angle * Math.PI) / 180;
      const radiusX = Math.min(36, 22 + count * 1.2 + (index % 3) * 5);
      const radiusY = Math.min(38, 24 + count * 1.1 + (index % 3) * 5);
      positions[id] = {
        x: clamp(50 + Math.cos(radians) * radiusX, 8, 92),
        y: clamp(50 + Math.sin(radians) * radiusY, 10, 90)
      };
    });
    positions[centerId] = { x: 50, y: 50 };
    return forceRelaxGraphPositions(centerId, otherIds, positions, saved);
  }

  function forceRelaxGraphPositions(centerId, otherIds, positions, saved) {
    const centerX = SVG_W / 2;
    const centerY = SVG_H / 2;
    const savedIds = new Set(
      Object.entries(saved)
        .filter(([, position]) => Number.isFinite(Number(position?.x)) && Number.isFinite(Number(position?.y)))
        .map(([id]) => id)
    );
    const nodes = [centerId, ...otherIds].map((id) => {
      const point = pctToSvg(positions[id] || { x: 50, y: 50 });
      return {
        id,
        x: point.x,
        y: point.y,
        vx: 0,
        vy: 0,
        fixed: id === centerId || savedIds.has(id)
      };
    });
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const targetDistance = otherIds.length <= 2 ? 285 : otherIds.length <= 8 ? 250 : 220;

    for (let tick = 0; tick < 180; tick += 1) {
      const alpha = 1 - tick / 180;
      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const a = nodes[i];
          const b = nodes[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let distance = Math.hypot(dx, dy);
          if (distance < 0.01) {
            dx = 1;
            dy = 0;
            distance = 1;
          }
          const minDistance = a.id === centerId || b.id === centerId ? 150 : 118;
          let force = (7600 * alpha) / (distance * distance);
          if (distance < minDistance) force += (minDistance - distance) * 0.055 * alpha;
          const fx = (dx / distance) * force;
          const fy = (dy / distance) * force;
          if (!a.fixed) {
            a.vx -= fx;
            a.vy -= fy;
          }
          if (!b.fixed) {
            b.vx += fx;
            b.vy += fy;
          }
        }
      }

      for (const id of otherIds) {
        const node = byId.get(id);
        if (!node || node.fixed) continue;
        const dx = node.x - centerX;
        const dy = node.y - centerY;
        const distance = Math.max(1, Math.hypot(dx, dy));
        const linkForce = (distance - targetDistance) * 0.018 * alpha;
        node.vx -= (dx / distance) * linkForce;
        node.vy -= (dy / distance) * linkForce;
        node.vx += (centerX - node.x) * 0.0015 * alpha;
        node.vy += (centerY - node.y) * 0.0015 * alpha;
      }

      for (const node of nodes) {
        if (node.fixed) continue;
        node.vx *= 0.84;
        node.vy *= 0.84;
        node.x = clamp(node.x + node.vx, 80, SVG_W - 80);
        node.y = clamp(node.y + node.vy, 74, SVG_H - 74);
      }
    }

    const relaxed = { [centerId]: { x: 50, y: 50 } };
    for (const id of otherIds) {
      const node = byId.get(id);
      if (!node) continue;
      relaxed[id] = {
        x: clamp((node.x / SVG_W) * 100, 8, 92),
        y: clamp((node.y / SVG_H) * 100, 10, 90)
      };
    }
    return relaxed;
  }

  function renderEmptyGraph(message) {
    cancelPendingDragFrame();
    graphElements = emptyGraphElements();
    dom.relationGraph.innerHTML = "";
    const text = svgElement("text", {
      class: "graph-empty",
      x: SVG_W / 2,
      y: SVG_H / 2
    });
    text.textContent = message;
    dom.relationGraph.appendChild(text);
    dom.graphStatus.textContent = message;
  }

  function renderGraphSvg(center, relations, positions) {
    cancelPendingDragFrame();
    graphElements = emptyGraphElements();
    dom.relationGraph.innerHTML = "";
    appendGraphDefs(dom.relationGraph);
    appendGraphDecor(dom.relationGraph);

    if (!relations.length) {
      const centerPos = pctToSvg(positions[center.id] || { x: 50, y: 50 });
      const centerNode = createGraphNode(center, centerPos, true);
      graphElements.nodes.set(center.id, centerNode);
      dom.relationGraph.appendChild(centerNode);
      applyGraphPositions();
      return;
    }

    const seenOther = new Set();
    relations.forEach((relation, index) => {
      const otherId = relation.personAId === center.id ? relation.personBId : relation.personAId;
      if (seenOther.has(otherId)) return;
      seenOther.add(otherId);
      const link = createGraphLink(index);
      const label = createGraphLabel(relation.definition);
      graphElements.links.push({
        element: link,
        fromId: center.id,
        toId: otherId,
        index
      });
      graphElements.labels.push({
        element: label,
        fromId: center.id,
        toId: otherId
      });
      dom.relationGraph.append(link, label);
    });

    const centerNode = createGraphNode(center, pctToSvg(positions[center.id]), true);
    graphElements.nodes.set(center.id, centerNode);
    dom.relationGraph.appendChild(centerNode);
    for (const otherId of seenOther) {
      const person = findPerson(otherId);
      if (!person) continue;
      const node = createGraphNode(person, pctToSvg(positions[otherId]), false);
      graphElements.nodes.set(otherId, node);
      dom.relationGraph.appendChild(node);
    }
    applyGraphPositions();
  }

  function appendGraphDefs(svg) {
    const defs = svgElement("defs");
    const markerEnd = svgElement("marker", {
      id: "arrowEnd",
      markerWidth: "10",
      markerHeight: "10",
      refX: "9",
      refY: "3",
      orient: "auto",
      markerUnits: "strokeWidth"
    });
    const markerStart = svgElement("marker", {
      id: "arrowStart",
      markerWidth: "10",
      markerHeight: "10",
      refX: "1",
      refY: "3",
      orient: "auto",
      markerUnits: "strokeWidth"
    });
    const endPath = svgElement("path", { d: "M0,0 L9,3 L0,6 Z", fill: "#315f8c" });
    const startPath = svgElement("path", { d: "M9,0 L0,3 L9,6 Z", fill: "#315f8c" });
    markerEnd.appendChild(endPath);
    markerStart.appendChild(startPath);
    defs.append(markerStart, markerEnd);
    svg.appendChild(defs);
  }

  function appendGraphDecor(svg) {
    const bg = svgElement("rect", {
      x: 0,
      y: 0,
      width: SVG_W,
      height: SVG_H,
      fill: "#fffdf9"
    });
    svg.appendChild(bg);

    [120, 210, 300].forEach((radius) => {
      const circle = svgElement("circle", {
        cx: SVG_W / 2,
        cy: SVG_H / 2,
        r: radius,
        fill: "none",
        stroke: "#d7c8a2",
        "stroke-width": 1.2,
        "stroke-dasharray": "3 8",
        opacity: 0.7
      });
      svg.appendChild(circle);
    });

    const title = svgElement("text", {
      x: 32,
      y: 36,
      fill: "#8c6d25",
      "font-size": 18,
      "font-weight": 700
    });
    title.textContent = "Correlation Diagram";
    svg.appendChild(title);
  }

  function createGraphLink(index) {
    return svgElement("line", {
      class: `graph-link${index % 2 ? " secondary" : ""}`,
      "marker-start": "url(#arrowStart)",
      "marker-end": "url(#arrowEnd)"
    });
  }

  function createGraphLabel(definition) {
    const group = svgElement("g");
    const labels = String(definition || "")
      .split("、")
      .filter(Boolean)
      .slice(0, 4);
    const width = Math.max(86, Math.max(...labels.map((item) => charLength(item))) * 18 + 26);
    const height = Math.max(30, labels.length * 22 + 10);
    group.dataset.width = String(width);
    group.dataset.height = String(height);
    const text = svgElement("text", {
      class: "graph-label"
    });
    labels.forEach((label, index) => {
      const tspan = svgElement("tspan", {
        dy: index === 0 ? 0 : 22
      });
      tspan.textContent = label;
      text.appendChild(tspan);
    });
    group.append(text);
    return group;
  }

  function applyGraphPositions() {
    if (!graphElements.nodes.size) return;
    for (const [id, node] of graphElements.nodes) {
      const position = pctToSvg(currentGraphPositions[id] || { x: 50, y: 50 });
      node.setAttribute("transform", `translate(${round2(position.x)} ${round2(position.y)})`);
    }
    for (const link of graphElements.links) {
      const from = pctToSvg(currentGraphPositions[link.fromId]);
      const to = pctToSvg(currentGraphPositions[link.toId]);
      if (!from || !to) continue;
      const adjusted = adjustLineForNodeRadii(from, to, 72, 56);
      link.element.setAttribute("x1", round2(adjusted.x1));
      link.element.setAttribute("y1", round2(adjusted.y1));
      link.element.setAttribute("x2", round2(adjusted.x2));
      link.element.setAttribute("y2", round2(adjusted.y2));
    }
    for (const label of graphElements.labels) {
      const from = pctToSvg(currentGraphPositions[label.fromId]);
      const to = pctToSvg(currentGraphPositions[label.toId]);
      if (!from || !to) continue;
      positionGraphLabel(label.element, from, to);
    }
  }

  function positionGraphLabel(group, from, to) {
    const text = group.querySelector("text");
    if (!text) return;
    const width = Number(group.dataset.width) || 86;
    const height = Number(group.dataset.height) || 30;
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2;
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const offsetX = Math.cos(angle - Math.PI / 2) * 18;
    const offsetY = Math.sin(angle - Math.PI / 2) * 18;
    const x = clamp(midX + offsetX, width / 2 + 4, SVG_W - width / 2 - 4);
    const y = clamp(midY + offsetY, height / 2 + 4, SVG_H - height / 2 - 4);
    text.setAttribute("x", round2(x));
    text.setAttribute("y", round2(y - (text.children.length - 1) * 11));
    for (const tspan of text.children) {
      tspan.setAttribute("x", round2(x));
    }
  }

  function createGraphNode(person, position, isCenter) {
    const group = svgElement("g", {
      class: `graph-node${isCenter ? " center fixed" : ""}`,
      "data-id": person.id,
      style: `--node-ring-color: ${countryColor(person.country)}`,
      transform: `translate(${position.x} ${position.y})`
    });
    if (!isCenter) {
      group.addEventListener("pointerdown", onNodePointerDown);
    }

    const radius = isCenter ? 66 : 48;
    const clipId = `clip-${safeSvgId(person.id)}`;
    const defs = dom.relationGraph.querySelector("defs");
    const clip = svgElement("clipPath", { id: clipId });
    clip.appendChild(svgElement("circle", { cx: 0, cy: 0, r: radius - 6 }));
    defs.appendChild(clip);

    group.appendChild(
      svgElement("circle", {
        class: "node-ring",
        cx: 0,
        cy: 0,
        r: radius,
        style: `stroke: ${countryColor(person.country)}`
      })
    );
    group.appendChild(
      svgElement("image", {
        href: avatarFor(person),
        x: -(radius - 7),
        y: -(radius - 7),
        width: (radius - 7) * 2,
        height: (radius - 7) * 2,
        "clip-path": `url(#${clipId})`,
        preserveAspectRatio: "xMidYMid slice"
      })
    );

    const nameY = radius + 24;
    const text = svgElement("text", {
      class: "graph-name",
      x: 0,
      y: nameY
    });
    text.textContent = person.name;
    group.appendChild(text);
    return group;
  }

  function countryColor(country) {
    return COUNTRY_COLORS[country] || "#b08a36";
  }

  function onNodePointerDown(event) {
    if (!canWriteCloud()) return;
    const node = event.currentTarget;
    const id = node.dataset.id;
    if (!id || !currentCenterId) return;
    event.preventDefault();
    node.setPointerCapture(event.pointerId);
    dragState = {
      id,
      pointerId: event.pointerId,
      node
    };
    node.addEventListener("pointermove", onNodePointerMove);
    node.addEventListener("pointerup", onNodePointerUp);
    node.addEventListener("pointercancel", onNodePointerUp);
  }

  function onNodePointerMove(event) {
    if (!dragState) return;
    pendingDragPoint = {
      clientX: event.clientX,
      clientY: event.clientY
    };
    if (!dragAnimationFrame) {
      dragAnimationFrame = requestAnimationFrame(flushPendingDrag);
    }
  }

  function onNodePointerUp(event) {
    const node = event.currentTarget;
    if (dragAnimationFrame) {
      cancelAnimationFrame(dragAnimationFrame);
      dragAnimationFrame = 0;
      flushPendingDrag();
    }
    node.removeEventListener("pointermove", onNodePointerMove);
    node.removeEventListener("pointerup", onNodePointerUp);
    node.removeEventListener("pointercancel", onNodePointerUp);
    try {
      node.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released by the browser.
    }
    dragState = null;
    pendingDragPoint = null;
    updateGraphStatusDirty();
  }

  function flushPendingDrag() {
    dragAnimationFrame = 0;
    if (!dragState || !pendingDragPoint) return;
    const point = clientPointToSvg(pendingDragPoint.clientX, pendingDragPoint.clientY);
    const x = clamp((point.x / SVG_W) * 100, 8, 92);
    const y = clamp((point.y / SVG_H) * 100, 10, 90);
    currentGraphPositions[dragState.id] = { x, y };
    graphDirty = true;
    applyGraphPositions();
  }

  function cancelPendingDragFrame() {
    if (dragAnimationFrame) {
      cancelAnimationFrame(dragAnimationFrame);
      dragAnimationFrame = 0;
    }
    pendingDragPoint = null;
  }

  function renderGraphFromCurrentPositions() {
    const center = findPerson(currentCenterId);
    if (!center) return;
    const relatedRelations = filteredGraphRelations(currentCenterId);
    currentGraphPositions[currentCenterId] = { x: 50, y: 50 };
    if (graphElements.nodes.size) {
      applyGraphPositions();
      return;
    }
    renderGraphSvg(center, relatedRelations, currentGraphPositions);
  }

  function clientPointToSvg(clientX, clientY) {
    const point = dom.relationGraph.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const matrix = dom.relationGraph.getScreenCTM().inverse();
    return point.matrixTransform(matrix);
  }

  function saveCurrentGraphLayout() {
    if (!requireWriteAccess()) return;
    if (!currentCenterId) {
      showToast("请先选择中心人物");
      return;
    }
    const positions = {};
    const savedPositions = state.layouts[currentCenterId]?.positions || {};
    for (const [id, position] of Object.entries(savedPositions)) {
      if (id === currentCenterId) continue;
      if (!findPerson(id)) continue;
      positions[id] = {
        x: round2(position.x),
        y: round2(position.y)
      };
    }
    for (const [id, position] of Object.entries(currentGraphPositions)) {
      if (id === currentCenterId) continue;
      positions[id] = {
        x: round2(position.x),
        y: round2(position.y)
      };
    }
    state.layouts[currentCenterId] = {
      positions,
      updatedAt: new Date().toISOString()
    };
    saveState();
    graphDirty = false;
    updateGraphStatusDirty();
    showToast("当前中心人物的图谱布局已保存");
  }

  function resetCurrentGraphLayout() {
    if (!requireWriteAccess()) return;
    if (!currentCenterId) {
      showToast("请先选择中心人物");
      return;
    }
    delete state.layouts[currentCenterId];
    saveState();
    deleteCloudRows("graph_layouts", `center_id=eq.${encodeURIComponent(currentCenterId)}`);
    renderGraph();
    showToast("当前中心人物的图谱布局已重置");
  }

  function updateGraphStatusDirty() {
    const center = findPerson(currentCenterId);
    if (!center) return;
    const count = filteredGraphRelations(currentCenterId).length;
    dom.graphStatus.textContent = `${count} 条关系${graphDirty ? "，布局未保存" : ""}`;
  }

  async function exportGraphPng() {
    if (!currentCenterId || !dom.relationGraph.querySelector(".graph-node")) {
      showToast("请先生成关系图");
      return;
    }
    try {
      const svg = dom.relationGraph.cloneNode(true);
      svg.setAttribute("xmlns", SVG_NS);
      svg.setAttribute("width", "1600");
      svg.setAttribute("height", "992");
      const style = document.createElementNS(SVG_NS, "style");
      style.textContent = `
        .graph-link{stroke:#315f8c;stroke-width:2.2;fill:none}
        .graph-link.secondary{stroke:#49735a}
        .graph-label{fill:#6b5222;font-size:16px;font-weight:800;text-anchor:middle;dominant-baseline:central;paint-order:stroke;stroke:rgba(255,253,249,.86);stroke-width:4px;stroke-linejoin:round}
        .graph-node circle.node-ring{fill:#fff8ec;stroke:var(--node-ring-color,#b08a36);stroke-width:3}
        .graph-node.center circle.node-ring{stroke-width:4}
        .graph-name{fill:#252323;font-size:17px;font-weight:800;text-anchor:middle;paint-order:stroke;stroke:rgba(255,253,249,.88);stroke-width:4px;stroke-linejoin:round}
        .graph-node.center .graph-name{font-size:20px}
      `;
      svg.insertBefore(style, svg.firstChild);
      const serialized = new XMLSerializer().serializeToString(svg);
      const blob = new Blob([serialized], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const image = await loadImage(url);
      URL.revokeObjectURL(url);

      const canvas = document.createElement("canvas");
      canvas.width = 1600;
      canvas.height = 992;
      const context = canvas.getContext("2d");
      context.fillStyle = "#fffdf9";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const pngUrl = canvas.toDataURL("image/png");
      const center = findPerson(currentCenterId);
      downloadUrl(pngUrl, `${safeFileName(center?.name || "relationship")}-关系图.png`);
      showToast("关系图 PNG 已导出");
    } catch (error) {
      showToast(error.message || "PNG 导出失败");
    }
  }

  function renderSageNetwork() {
    if (!dom.sageNetworkGraph) return;
    const sages = state.characters.filter((person) => normalizeSageStatus(person.sageStatus) === "贤魔");
    const sageIds = new Set(sages.map((person) => person.id));
    if (selectedSageNetworkId && !sageIds.has(selectedSageNetworkId)) {
      selectedSageNetworkId = "";
    }

    const relations = state.relationships.filter(
      (relation) => sageIds.has(relation.personAId) && sageIds.has(relation.personBId)
    );
    dom.sageNetworkGraph.innerHTML = "";
    appendSageNetworkDecor(dom.sageNetworkGraph);

    if (!sages.length) {
      const text = svgElement("text", {
        class: "graph-empty",
        x: SAGE_NETWORK_W / 2,
        y: SAGE_NETWORK_H / 2
      });
      text.textContent = "暂无贤魔人物";
      dom.sageNetworkGraph.appendChild(text);
      dom.sageNetworkStatus.textContent = "暂无贤魔人物";
      return;
    }

    const positions = buildSageNetworkPositions(sages);
    const selectedRelations = selectedSageNetworkId
      ? relations.filter(
          (relation) =>
            relation.personAId === selectedSageNetworkId || relation.personBId === selectedSageNetworkId
        )
      : [];
    const connectedIds = new Set();
    selectedRelations.forEach((relation) => {
      connectedIds.add(relation.personAId);
      connectedIds.add(relation.personBId);
    });

    const linkLayer = svgElement("g", { class: "sage-network-links" });
    const labelLayer = svgElement("g", { class: "sage-network-labels" });
    const nodeLayer = svgElement("g", { class: "sage-network-nodes" });

    relations.forEach((relation, index) => {
      const from = positions[relation.personAId];
      const to = positions[relation.personBId];
      if (!from || !to) return;
      const isFocused =
        selectedSageNetworkId &&
        (relation.personAId === selectedSageNetworkId || relation.personBId === selectedSageNetworkId);
      const line = sageNetworkLine(from, to);
      const link = svgElement("path", {
        class: `sage-network-link${isFocused ? " highlight" : selectedSageNetworkId ? " dimmed" : ""}`,
        d: line.path,
        "data-index": index
      });
      linkLayer.appendChild(link);
      if (isFocused) {
        labelLayer.appendChild(createSageNetworkLabel(relation.definition, line.label));
      }
    });

    sages.forEach((person) => {
      const isActive = person.id === selectedSageNetworkId;
      const isConnected = selectedSageNetworkId && connectedIds.has(person.id);
      const isDimmed = selectedSageNetworkId && !isActive && !isConnected;
      nodeLayer.appendChild(
        createSageNetworkNode(person, positions[person.id], {
          active: isActive,
          connected: isConnected && !isActive,
          dimmed: isDimmed
        })
      );
    });

    dom.sageNetworkGraph.append(linkLayer, labelLayer, nodeLayer);
    if (selectedSageNetworkId) {
      const selected = findPerson(selectedSageNetworkId);
      dom.sageNetworkStatus.textContent = `${selected?.name || "当前贤魔"}：${
        Math.max(connectedIds.size - 1, 0)
      } 位相关贤魔，${selectedRelations.length} 条关系`;
    } else {
      dom.sageNetworkStatus.textContent = `${sages.length} 位贤魔，${relations.length} 条贤魔间关系`;
    }
  }

  function clearSageNetworkFocus() {
    if (!selectedSageNetworkId) return;
    selectedSageNetworkId = "";
    renderSageNetwork();
  }

  function buildSageNetworkPositions(sages) {
    const positions = {};
    const centerX = SAGE_NETWORK_W / 2;
    const centerY = SAGE_NETWORK_H / 2;
    const radius = 290;
    const count = Math.max(sages.length, 1);
    sages.forEach((person, index) => {
      const angle = -Math.PI / 2 + (index / count) * Math.PI * 2;
      positions[person.id] = {
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius
      };
    });
    return positions;
  }

  function appendSageNetworkDecor(svg) {
    const defs = svgElement("defs");
    svg.appendChild(defs);
    svg.appendChild(
      svgElement("rect", {
        x: 0,
        y: 0,
        width: SAGE_NETWORK_W,
        height: SAGE_NETWORK_H,
        fill: "#fffdf9"
      })
    );
    svg.appendChild(
      svgElement("circle", {
        cx: SAGE_NETWORK_W / 2,
        cy: SAGE_NETWORK_H / 2,
        r: 290,
        fill: "none",
        stroke: "#d7c8a2",
        "stroke-width": 1.2,
        "stroke-dasharray": "3 9",
        opacity: 0.8
      })
    );
  }

  function sageNetworkLine(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.hypot(dx, dy) || 1;
    const ux = dx / distance;
    const uy = dy / distance;
    const start = {
      x: from.x + ux * (SAGE_NETWORK_NODE_R + 8),
      y: from.y + uy * (SAGE_NETWORK_NODE_R + 8)
    };
    const end = {
      x: to.x - ux * (SAGE_NETWORK_NODE_R + 8),
      y: to.y - uy * (SAGE_NETWORK_NODE_R + 8)
    };
    const label = {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2
    };
    return {
      path: `M ${round2(start.x)} ${round2(start.y)} L ${round2(end.x)} ${round2(end.y)}`,
      label
    };
  }

  function createSageNetworkNode(person, position, stateClass) {
    const classes = ["sage-network-node"];
    if (stateClass.active) classes.push("active");
    if (stateClass.connected) classes.push("connected");
    if (stateClass.dimmed) classes.push("dimmed");
    const group = svgElement("g", {
      class: classes.join(" "),
      "data-id": person.id,
      style: `--node-ring-color: ${countryColor(person.country)}`,
      transform: `translate(${round2(position.x)} ${round2(position.y)})`
    });
    group.addEventListener("click", (event) => {
      event.stopPropagation();
      selectedSageNetworkId = selectedSageNetworkId === person.id ? "" : person.id;
      renderSageNetwork();
    });

    const clipId = `sage-clip-${safeSvgId(person.id)}`;
    const defs = dom.sageNetworkGraph.querySelector("defs");
    const clip = svgElement("clipPath", { id: clipId });
    clip.appendChild(svgElement("circle", { cx: 0, cy: 0, r: SAGE_NETWORK_NODE_R - 5 }));
    defs.appendChild(clip);

    group.appendChild(
      svgElement("circle", {
        class: "node-ring",
        cx: 0,
        cy: 0,
        r: SAGE_NETWORK_NODE_R,
        style: `stroke: ${countryColor(person.country)}`
      })
    );
    group.appendChild(
      svgElement("image", {
        href: avatarFor(person),
        x: -(SAGE_NETWORK_NODE_R - 6),
        y: -(SAGE_NETWORK_NODE_R - 6),
        width: (SAGE_NETWORK_NODE_R - 6) * 2,
        height: (SAGE_NETWORK_NODE_R - 6) * 2,
        "clip-path": `url(#${clipId})`,
        preserveAspectRatio: "xMidYMid slice"
      })
    );
    const namePosition = sageNetworkNamePosition(position);
    const name = svgElement("text", {
      class: "sage-network-name",
      x: namePosition.x,
      y: namePosition.y,
      "text-anchor": namePosition.anchor,
      "dominant-baseline": "central"
    });
    name.textContent = person.name;
    group.appendChild(name);
    return group;
  }

  function sageNetworkNamePosition(position) {
    const dx = position.x - SAGE_NETWORK_W / 2;
    const dy = position.y - SAGE_NETWORK_H / 2;
    const distance = Math.hypot(dx, dy) || 1;
    const ux = dx / distance;
    const uy = dy / distance;
    const labelDistance = SAGE_NETWORK_NODE_R + 20;
    let anchor = "middle";
    if (ux > 0.32) anchor = "start";
    if (ux < -0.32) anchor = "end";
    return {
      x: round2(ux * labelDistance),
      y: round2(uy * labelDistance),
      anchor
    };
  }

  function createSageNetworkLabel(definition, point) {
    const group = svgElement("g");
    const labels = String(definition || "")
      .split("、")
      .filter(Boolean)
      .slice(0, 3);
    const text = svgElement("text", {
      class: "sage-network-label",
      x: round2(clamp(point.x, 64, SAGE_NETWORK_W - 64)),
      y: round2(clamp(point.y, 44, SAGE_NETWORK_H - 44))
    });
    (labels.length ? labels : ["关系"]).forEach((label, index) => {
      const tspan = svgElement("tspan", {
        x: text.getAttribute("x"),
        dy: index === 0 ? 0 : 18
      });
      tspan.textContent = label;
      text.appendChild(tspan);
    });
    group.appendChild(text);
    return group;
  }

  function exportJson(scope) {
    const exportedAt = new Date().toISOString();
    if (scope === "people") {
      downloadJson({ version: 1, exportedAt, characters: state.characters }, "人物信息库.json");
      return;
    }
    if (scope === "relations") {
      downloadJson(
        { version: 1, exportedAt, relationships: relationsForExportJson() },
        "人物关系库.json"
      );
      return;
    }
    downloadJson({ version: 1, exportedAt, ...state }, "人物关系全库.json");
  }

  function exportExcel(scope) {
    if (scope === "people") {
      downloadXlsx([{ name: "人物信息库", rows: charactersToRows() }], "人物信息库.xlsx");
      return;
    }
    if (scope === "relations") {
      downloadXlsx([{ name: "人物关系库", rows: relationsToRows() }], "人物关系库.xlsx");
      return;
    }
    downloadXlsx(
      [
        { name: "人物信息库", rows: charactersToRows() },
        { name: "人物关系库", rows: relationsToRows() },
        { name: "图谱布局", rows: layoutsToRows() }
      ],
      "人物关系全库.xlsx"
    );
  }

  function downloadJson(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json;charset=utf-8"
    });
    downloadBlob(blob, filename);
  }

  function charactersToRows() {
    const rows = [CHARACTER_FIELDS.map(([, label]) => label)];
    for (const character of state.characters) {
      rows.push(CHARACTER_FIELDS.map(([key]) => character[key] ?? ""));
    }
    return rows;
  }

  function relationsToRows() {
    const rows = [RELATION_FIELDS.map(([, label]) => label)];
    for (const relation of state.relationships) {
      const personA = findPerson(relation.personAId);
      const personB = findPerson(relation.personBId);
      rows.push(
        RELATION_FIELDS.map(([key]) => {
          if (key === "personAName") return personA?.name || "";
          if (key === "personBName") return personB?.name || "";
          return relation[key] ?? "";
        })
      );
    }
    return rows;
  }

  function layoutsToRows() {
    const rows = [LAYOUT_FIELDS.map(([, label]) => label)];
    for (const [centerId, layout] of Object.entries(state.layouts)) {
      const center = findPerson(centerId);
      for (const [personId, position] of Object.entries(layout.positions || {})) {
        const person = findPerson(personId);
        rows.push([
          center?.name || "",
          centerId,
          person?.name || "",
          personId,
          position.x,
          position.y
        ]);
      }
    }
    return rows;
  }

  function relationsForExportJson() {
    return state.relationships.map((relation) => {
      const personA = findPerson(relation.personAId);
      const personB = findPerson(relation.personBId);
      return {
        ...relation,
        personAName: personA?.name || "",
        personBName: personB?.name || ""
      };
    });
  }

  async function importFile(file, scope) {
    if (!requireWriteAccess()) return;
    const imported = await readImportFile(file);
    const summary = {
      peopleAdded: 0,
      peopleUpdated: 0,
      relationsAdded: 0,
      relationsUpdated: 0,
      layoutsImported: 0,
      skipped: []
    };

    if (imported.kind === "json") {
      importJsonData(imported.data, scope, summary);
    } else {
      importWorkbookData(imported.workbook, scope, summary);
    }

    saveState();
    renderAll();
    showToast(importSummaryText(summary));
  }

  async function readImportFile(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith(".json")) {
      return {
        kind: "json",
        data: JSON.parse(await file.text())
      };
    }
    return {
      kind: "workbook",
      workbook: await readWorkbook(file)
    };
  }

  function importJsonData(data, scope, summary) {
    if (!data || typeof data !== "object") throw new Error("JSON 格式不正确");
    if (scope === "people") {
      importCharacters(Array.isArray(data) ? data : data.characters || [], summary);
      return;
    }
    if (scope === "relations") {
      if (Array.isArray(data.characters)) importCharacters(data.characters, summary);
      importRelations(Array.isArray(data) ? data : data.relationships || [], summary);
      return;
    }
    importCharacters(data.characters || [], summary);
    importRelations(data.relationships || [], summary);
    importLayouts(data.layouts || {}, summary);
  }

  function importWorkbookData(workbook, scope, summary) {
    if (scope === "people") {
      importCharacters(rowsToCharacterObjects(findSheetRows(workbook, "people")), summary);
      return;
    }
    if (scope === "relations") {
      const peopleRows = tryFindSheetRows(workbook, "people");
      if (peopleRows) importCharacters(rowsToCharacterObjects(peopleRows), summary);
      importRelations(rowsToRelationObjects(findSheetRows(workbook, "relations")), summary);
      return;
    }
    const peopleRows = tryFindSheetRows(workbook, "people");
    const relationRows = tryFindSheetRows(workbook, "relations");
    const layoutRows = tryFindSheetRows(workbook, "layouts");
    if (peopleRows) importCharacters(rowsToCharacterObjects(peopleRows), summary);
    if (relationRows) importRelations(rowsToRelationObjects(relationRows), summary);
    if (layoutRows) importLayoutsFromRows(rowsToLayoutObjects(layoutRows), summary);
    if (!peopleRows && !relationRows && !layoutRows) {
      throw new Error("未找到可识别的人物、关系或布局表");
    }
  }

  function importCharacters(items, summary) {
    if (!Array.isArray(items)) return;
    for (const raw of items) {
      try {
        const character = normalizeImportedCharacter(raw);
        const existing = findExistingCharacter(character);
        if (existing) {
          Object.assign(existing, {
            ...existing,
            ...character,
            id: existing.id,
            avatarData: character.avatarData || existing.avatarData || "",
            avatarPath: character.avatarPath || existing.avatarPath || "",
            avatarUrl: character.avatarUrl || existing.avatarUrl || "",
            updatedAt: new Date().toISOString()
          });
          summary.peopleUpdated += 1;
        } else {
          state.characters.push({
            ...character,
            id: character.id || createId("char"),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
          summary.peopleAdded += 1;
        }
      } catch (error) {
        summary.skipped.push(`人物：${error.message}`);
      }
    }
  }

  function normalizeImportedCharacter(raw) {
    const name = String(raw.name ?? raw.personName ?? "").trim();
    const country = String(raw.country ?? "").trim();
    const gender = String(raw.gender ?? "").trim();
    const sageStatus = normalizeSageStatus(raw.sageStatus);
    const age = normalizeAge(raw.age);
    const height = normalizeOptionalHeight(raw.height);
    const birthday = parseOptionalBirthdayText(raw.birthday, raw.birthdayMonth, raw.birthdayDay);
    const magicTool = String(raw.magicTool ?? "").trim();
    const manaDomain = String(raw.manaDomain ?? "").trim();
    if (!name) throw new Error("缺少姓名");
    if (!COUNTRIES.includes(country)) throw new Error(`${name} 的国家不在五选一内`);
    if (!GENDERS.includes(gender)) throw new Error(`${name} 的性别不合法`);
    if (manaDomain.length > 10) throw new Error(`${name} 的 mana 域超过 10 字`);
    const duplicate = state.characters.find((item) => item.name === name && item.id !== raw.id);
    if (duplicate && raw.id && duplicate.id !== raw.id) {
      throw new Error(`${name} 与现有人物重名`);
    }
    return {
      id: String(raw.id || "").trim(),
      name,
      avatarData: isDataImage(raw.avatarData) ? raw.avatarData : "",
      avatarPath: String(raw.avatarPath || raw.avatar_path || "").trim(),
      avatarUrl: String(raw.avatarUrl || raw.avatar_url || "").trim(),
      country,
      gender,
      sageStatus,
      age,
      height,
      birthday,
      magicTool,
      crestPosition: String(raw.crestPosition ?? "").trim(),
      wounds: String(raw.wounds ?? "").trim(),
      manaDomain,
      magicSpecialty: String(raw.magicSpecialty ?? "").trim(),
      likes: String(raw.likes ?? "").trim(),
      dislikes: String(raw.dislikes ?? "").trim(),
      strengths: String(raw.strengths ?? "").trim(),
      weaknesses: String(raw.weaknesses ?? "").trim(),
      profile: String(raw.profile ?? "").trim()
    };
  }

  function findExistingCharacter(character) {
    if (character.id) {
      const byId = state.characters.find((item) => item.id === character.id);
      if (byId) return byId;
    }
    return state.characters.find((item) => item.name === character.name);
  }

  function importRelations(items, summary) {
    if (!Array.isArray(items)) return;
    for (const raw of items) {
      try {
        const relation = normalizeImportedRelation(raw);
        const existing = state.relationships.find((item) =>
          samePair(item.personAId, item.personBId, relation.personAId, relation.personBId)
        );
        if (existing) {
          existing.definition = mergeDefinitions(existing.definition, relation.definition);
          existing.description = relation.description || existing.description || "";
          existing.viewA = relation.viewA || existing.viewA || "";
          existing.viewB = relation.viewB || existing.viewB || "";
          existing.updatedAt = new Date().toISOString();
          summary.relationsUpdated += 1;
        } else {
          state.relationships.push({
            ...relation,
            id: relation.id || createId("rel"),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
          summary.relationsAdded += 1;
        }
      } catch (error) {
        summary.skipped.push(`关系：${error.message}`);
      }
    }
  }

  function normalizeImportedRelation(raw) {
    const personAId = resolvePersonId(raw.personAId, raw.personAName || raw.personA || raw.a);
    const personBId = resolvePersonId(raw.personBId, raw.personBName || raw.personB || raw.b);
    if (!personAId || !personBId) throw new Error("人物 A 或人物 B 未在人物库中找到");
    if (personAId === personBId) throw new Error("人物 A 和人物 B 不能相同");
    return {
      id: String(raw.id || "").trim(),
      personAId,
      personBId,
      definition: normalizeRelationDefinition(raw.definition || raw.relationshipDefinition),
      description: String(raw.description ?? "").trim(),
      viewA: String(raw.viewA ?? "").trim(),
      viewB: String(raw.viewB ?? "").trim()
    };
  }

  function resolvePersonId(id, name) {
    const idText = String(id || "").trim();
    if (idText && findPerson(idText)) return idText;
    const nameText = String(name || "").trim();
    if (!nameText) return "";
    const person = state.characters.find((item) => item.name === nameText);
    return person?.id || "";
  }

  function mergeDefinitions(current, incoming) {
    return unique(
      [...String(current || "").split("、"), ...String(incoming || "").split("、")]
        .map((item) => item.trim())
        .filter(Boolean)
    ).join("、");
  }

  function importLayouts(layouts, summary) {
    if (!layouts || typeof layouts !== "object") return;
    for (const [centerId, layout] of Object.entries(layouts)) {
      if (!findPerson(centerId) || !layout?.positions) continue;
      state.layouts[centerId] = {
        positions: {},
        updatedAt: layout.updatedAt || new Date().toISOString()
      };
      for (const [personId, position] of Object.entries(layout.positions)) {
        if (!findPerson(personId)) continue;
        state.layouts[centerId].positions[personId] = {
          x: clamp(Number(position.x), 8, 92),
          y: clamp(Number(position.y), 10, 90)
        };
        summary.layoutsImported += 1;
      }
    }
  }

  function importLayoutsFromRows(rows, summary) {
    for (const row of rows) {
      const centerId = resolvePersonId(row.centerId, row.centerName);
      const personId = resolvePersonId(row.personId, row.personName);
      if (!centerId || !personId || centerId === personId) {
        summary.skipped.push("布局：中心人物或节点人物未找到");
        continue;
      }
      if (!state.layouts[centerId]) {
        state.layouts[centerId] = {
          positions: {},
          updatedAt: new Date().toISOString()
        };
      }
      state.layouts[centerId].positions[personId] = {
        x: clamp(Number(row.x), 8, 92),
        y: clamp(Number(row.y), 10, 90)
      };
      summary.layoutsImported += 1;
    }
  }

  function importSummaryText(summary) {
    const parts = [
      `人物新增 ${summary.peopleAdded}`,
      `人物更新 ${summary.peopleUpdated}`,
      `关系新增 ${summary.relationsAdded}`,
      `关系更新 ${summary.relationsUpdated}`,
      `布局 ${summary.layoutsImported}`
    ];
    if (summary.skipped.length) parts.push(`跳过 ${summary.skipped.length} 条`);
    return parts.join("，");
  }

  function rowsToCharacterObjects(rows) {
    return rowsToObjects(rows).map((item) => ({
      id: pick(item, "id"),
      name: pick(item, "name"),
      country: pick(item, "country"),
      gender: pick(item, "gender"),
      sageStatus: pick(item, "sageStatus"),
      age: pick(item, "age"),
      height: pick(item, "height"),
      birthday: pick(item, "birthday"),
      birthdayMonth: pick(item, "birthdayMonth"),
      birthdayDay: pick(item, "birthdayDay"),
      magicTool: pick(item, "magicTool"),
      crestPosition: pick(item, "crestPosition"),
      wounds: pick(item, "wounds"),
      manaDomain: pick(item, "manaDomain"),
      magicSpecialty: pick(item, "magicSpecialty"),
      likes: pick(item, "likes"),
      dislikes: pick(item, "dislikes"),
      strengths: pick(item, "strengths"),
      weaknesses: pick(item, "weaknesses"),
      profile: pick(item, "profile"),
      avatarData: pick(item, "avatarData")
    }));
  }

  function rowsToRelationObjects(rows) {
    return rowsToObjects(rows).map((item) => ({
      id: pick(item, "id"),
      personAName: pick(item, "personAName"),
      personAId: pick(item, "personAId"),
      personBName: pick(item, "personBName"),
      personBId: pick(item, "personBId"),
      definition: pick(item, "definition"),
      description: pick(item, "description"),
      viewA: pick(item, "viewA"),
      viewB: pick(item, "viewB")
    }));
  }

  function rowsToLayoutObjects(rows) {
    return rowsToObjects(rows).map((item) => ({
      centerName: pick(item, "centerName"),
      centerId: pick(item, "centerId"),
      personName: pick(item, "personName"),
      personId: pick(item, "personId"),
      x: pick(item, "x"),
      y: pick(item, "y")
    }));
  }

  function rowsToObjects(rows) {
    const headerIndex = rows.findIndex((row) => row.some((cell) => String(cell || "").trim()));
    if (headerIndex < 0) return [];
    const headers = rows[headerIndex].map((cell) => normalizeHeader(cell));
    return rows.slice(headerIndex + 1).flatMap((row) => {
      if (!row.some((cell) => String(cell || "").trim())) return [];
      const object = {};
      headers.forEach((header, index) => {
        if (!header) return;
        object[header] = row[index] ?? "";
      });
      return object;
    });
  }

  function pick(object, canonicalKey) {
    const aliases = HEADER_ALIASES[canonicalKey] || [canonicalKey];
    for (const alias of aliases.map(normalizeHeader)) {
      if (Object.prototype.hasOwnProperty.call(object, alias)) return object[alias];
    }
    return "";
  }

  const HEADER_ALIASES = {
    id: ["id", "ID", "人物ID", "关系ID", "角色ID"],
    name: ["姓名", "名字", "人物姓名", "name"],
    personName: ["节点人物", "人物", "姓名"],
    country: ["国家", "country"],
    gender: ["性别", "gender"],
    sageStatus: ["是否贤魔", "贤魔状态", "贤魔", "sageStatus"],
    age: ["年龄", "age"],
    height: ["身高cm", "身高", "height", "heightcm"],
    birthday: ["生日", "birthday"],
    birthdayMonth: ["生日月份", "月份", "month"],
    birthdayDay: ["生日日期", "日期", "day"],
    magicTool: ["魔道具", "magicTool"],
    crestPosition: ["纹章位置", "纹章", "crestPosition"],
    wounds: ["伤", "伤痕", "wounds"],
    manaDomain: ["mana域", "mana", "manaDomain"],
    magicSpecialty: ["擅长的魔法", "魔法", "magicSpecialty"],
    likes: ["喜欢的事/物", "喜欢", "likes"],
    dislikes: ["讨厌的事/物", "讨厌", "dislikes"],
    strengths: ["擅长的事/物", "擅长", "strengths"],
    weaknesses: ["不擅长的事/物", "不擅长", "weaknesses"],
    profile: ["个人简介", "简介", "profile"],
    avatarData: ["外貌图像数据", "头像数据", "avatarData"],
    personAName: ["人物A", "人物A姓名", "A", "personA", "personAName"],
    personAId: ["人物A_ID", "人物AID", "personAId"],
    personBName: ["人物B", "人物B姓名", "B", "personB", "personBName"],
    personBId: ["人物B_ID", "人物BID", "personBId"],
    definition: ["人物关系定义", "关系定义", "关系", "definition"],
    description: ["人物关系描述", "关系描述", "描述", "description"],
    viewA: ["人物A对人物B看法", "A对B看法", "viewA"],
    viewB: ["人物B对人物A看法", "B对A看法", "viewB"],
    centerName: ["中心人物", "中心人物姓名", "centerName"],
    centerId: ["中心人物_ID", "中心人物ID", "centerId"],
    personId: ["节点人物_ID", "节点人物ID", "personId"],
    x: ["X", "x"],
    y: ["Y", "y"]
  };

  function normalizeHeader(value) {
    return String(value || "")
      .trim()
      .replace(/\s+/g, "")
      .replace(/[()（）]/g, "")
      .toLowerCase();
  }

  function findSheetRows(workbook, type) {
    const rows = tryFindSheetRows(workbook, type);
    if (!rows) {
      const label = type === "people" ? "人物信息库" : type === "relations" ? "人物关系库" : "图谱布局";
      throw new Error(`未找到 ${label} 工作表`);
    }
    return rows;
  }

  function tryFindSheetRows(workbook, type) {
    const namePatterns = {
      people: [/人物信息/, /人物库/, /角色/, /character/i, /people/i],
      relations: [/关系/, /relation/i],
      layouts: [/布局/, /layout/i]
    }[type];
    const requiredHeaders = {
      people: ["name", "country", "gender", "age"],
      relations: ["personAName", "personBName", "definition"],
      layouts: ["centerName", "personName", "x", "y"]
    }[type];

    for (const sheet of workbook.sheets) {
      if (namePatterns.some((pattern) => pattern.test(sheet.name))) return sheet.rows;
    }
    for (const sheet of workbook.sheets) {
      const headers = (sheet.rows.find((row) => row.some(Boolean)) || []).map(normalizeHeader);
      const object = Object.fromEntries(headers.map((header) => [header, true]));
      const matched = requiredHeaders.every((key) =>
        (HEADER_ALIASES[key] || [key]).map(normalizeHeader).some((alias) => object[alias])
      );
      if (matched) return sheet.rows;
    }
    return null;
  }

  async function readWorkbook(file) {
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".csv")) {
      const rows = parseCsv(await file.text());
      return { sheets: [{ name: "Sheet1", rows }] };
    }
    if (lower.endsWith(".xls")) {
      const text = await file.text();
      const rows = parseHtmlTableWorkbook(text);
      if (!rows.length) {
        throw new Error("旧式二进制 .xls 暂不支持，请另存为 .xlsx 或 CSV 后导入。");
      }
      return { sheets: [{ name: "Sheet1", rows }] };
    }
    if (!lower.endsWith(".xlsx")) {
      throw new Error("请导入 JSON、XLSX、XLS 或 CSV 文件");
    }
    return parseXlsx(await file.arrayBuffer());
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      const next = text[index + 1];
      if (quoted) {
        if (char === '"' && next === '"') {
          cell += '"';
          index += 1;
        } else if (char === '"') {
          quoted = false;
        } else {
          cell += char;
        }
      } else if (char === '"') {
        quoted = true;
      } else if (char === ",") {
        row.push(cell);
        cell = "";
      } else if (char === "\n") {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else if (char !== "\r") {
        cell += char;
      }
    }
    row.push(cell);
    rows.push(row);
    return rows;
  }

  function parseHtmlTableWorkbook(text) {
    const document = new DOMParser().parseFromString(text, "text/html");
    const table = document.querySelector("table");
    if (!table) return [];
    return Array.from(table.querySelectorAll("tr")).map((row) =>
      Array.from(row.children).map((cell) => cell.textContent.trim())
    );
  }

  async function parseXlsx(buffer) {
    const files = await unzipXlsx(buffer);
    const rootRels = parseRels(files["_rels/.rels"]);
    const officeRel = rootRels.find((rel) => /officeDocument$/.test(rel.type));
    const workbookPath = normalizeZipPath(officeRel?.target || "xl/workbook.xml");
    const workbookXml = files[workbookPath];
    if (!workbookXml) throw new Error("XLSX 中未找到 workbook.xml");
    const workbookDoc = parseXml(workbookXml);
    const workbookRelsPath = `${workbookPath.split("/").slice(0, -1).join("/")}/_rels/${workbookPath.split("/").pop()}.rels`;
    const workbookRels = parseRels(files[workbookRelsPath] || "");
    const relMap = Object.fromEntries(workbookRels.map((rel) => [rel.id, rel]));
    const sharedStrings = parseSharedStrings(files["xl/sharedStrings.xml"] || "");
    const sheets = Array.from(workbookDoc.getElementsByTagNameNS("*", "sheet")).map((sheet) => {
      const id = sheet.getAttribute("r:id") || sheet.getAttribute("id");
      const rel = relMap[id];
      const target = rel ? resolveZipPath(workbookPath, rel.target) : "";
      return {
        name: sheet.getAttribute("name") || "Sheet",
        rows: parseWorksheet(files[target] || "", sharedStrings)
      };
    });
    return { sheets };
  }

  async function unzipXlsx(buffer) {
    const view = new DataView(buffer);
    let eocdOffset = -1;
    for (let offset = buffer.byteLength - 22; offset >= Math.max(0, buffer.byteLength - 66000); offset -= 1) {
      if (view.getUint32(offset, true) === 0x06054b50) {
        eocdOffset = offset;
        break;
      }
    }
    if (eocdOffset < 0) throw new Error("XLSX 文件结构不完整");
    const entryCount = view.getUint16(eocdOffset + 10, true);
    const centralOffset = view.getUint32(eocdOffset + 16, true);
    const decoder = new TextDecoder("utf-8");
    const files = {};
    let pointer = centralOffset;
    for (let index = 0; index < entryCount; index += 1) {
      if (view.getUint32(pointer, true) !== 0x02014b50) break;
      const method = view.getUint16(pointer + 10, true);
      const compressedSize = view.getUint32(pointer + 20, true);
      const nameLength = view.getUint16(pointer + 28, true);
      const extraLength = view.getUint16(pointer + 30, true);
      const commentLength = view.getUint16(pointer + 32, true);
      const localOffset = view.getUint32(pointer + 42, true);
      const nameBytes = new Uint8Array(buffer, pointer + 46, nameLength);
      const name = decoder.decode(nameBytes).replace(/\\/g, "/");

      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = new Uint8Array(buffer, dataStart, compressedSize);
      let bytes;
      if (method === 0) {
        bytes = compressed;
      } else if (method === 8) {
        bytes = await inflateRaw(compressed);
      } else {
        throw new Error(`XLSX 压缩方式 ${method} 暂不支持`);
      }
      files[name] = decoder.decode(bytes);
      pointer += 46 + nameLength + extraLength + commentLength;
    }
    return files;
  }

  async function inflateRaw(bytes) {
    if (!("DecompressionStream" in window)) {
      throw new Error("当前浏览器不支持 XLSX 解压，请使用新版 Chrome/Edge，或导入 CSV。");
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function parseXml(xml) {
    const document = new DOMParser().parseFromString(xml, "application/xml");
    if (document.querySelector("parsererror")) throw new Error("XLSX XML 解析失败");
    return document;
  }

  function parseRels(xml) {
    if (!xml) return [];
    const document = parseXml(xml);
    return Array.from(document.getElementsByTagNameNS("*", "Relationship")).map((node) => ({
      id: node.getAttribute("Id"),
      type: node.getAttribute("Type") || "",
      target: node.getAttribute("Target") || ""
    }));
  }

  function parseSharedStrings(xml) {
    if (!xml) return [];
    const document = parseXml(xml);
    return Array.from(document.getElementsByTagNameNS("*", "si")).map((si) =>
      Array.from(si.getElementsByTagNameNS("*", "t"))
        .map((node) => node.textContent)
        .join("")
    );
  }

  function parseWorksheet(xml, sharedStrings) {
    if (!xml) return [];
    const document = parseXml(xml);
    const rows = [];
    for (const rowNode of Array.from(document.getElementsByTagNameNS("*", "row"))) {
      const row = [];
      for (const cellNode of Array.from(rowNode.getElementsByTagNameNS("*", "c"))) {
        const ref = cellNode.getAttribute("r") || "";
        const col = ref ? columnNameToIndex(ref.replace(/\d+/g, "")) : row.length;
        row[col] = readCellValue(cellNode, sharedStrings);
      }
      rows.push(row.map((cell) => cell ?? ""));
    }
    return rows;
  }

  function readCellValue(cellNode, sharedStrings) {
    const type = cellNode.getAttribute("t");
    if (type === "inlineStr") {
      return Array.from(cellNode.getElementsByTagNameNS("*", "t"))
        .map((node) => node.textContent)
        .join("");
    }
    const valueNode = cellNode.getElementsByTagNameNS("*", "v")[0];
    const value = valueNode ? valueNode.textContent : "";
    if (type === "s") return sharedStrings[Number(value)] || "";
    if (type === "b") return value === "1" ? "TRUE" : "FALSE";
    return value;
  }

  function downloadXlsx(sheets, filename) {
    const files = buildXlsxFiles(sheets);
    const blob = createZipBlob(files);
    downloadBlob(blob, filename);
  }

  function buildXlsxFiles(sheets) {
    const safeSheets = sheets.map((sheet, index) => ({
      name: safeSheetName(sheet.name || `Sheet${index + 1}`, index),
      rows: sheet.rows || []
    }));
    const sheetContentTypes = safeSheets
      .map(
        (_, index) =>
          `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
      )
      .join("");
    const workbookSheets = safeSheets
      .map(
        (sheet, index) =>
          `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
      )
      .join("");
    const workbookRels = safeSheets
      .map(
        (_, index) =>
          `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
      )
      .join("");

    const files = [
      {
        name: "[Content_Types].xml",
        content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheetContentTypes}
</Types>`
      },
      {
        name: "_rels/.rels",
        content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`
      },
      {
        name: "xl/workbook.xml",
        content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${workbookSheets}</sheets>
</workbook>`
      },
      {
        name: "xl/_rels/workbook.xml.rels",
        content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${workbookRels}
<Relationship Id="rId${safeSheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`
      },
      {
        name: "xl/styles.xml",
        content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="1"><fill><patternFill patternType="none"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
</styleSheet>`
      }
    ];

    safeSheets.forEach((sheet, index) => {
      files.push({
        name: `xl/worksheets/sheet${index + 1}.xml`,
        content: sheetXml(sheet.rows)
      });
    });
    return files;
  }

  function sheetXml(rows) {
    const rowXml = rows
      .map((row, rowIndex) => {
        const cells = row
          .map((value, colIndex) => {
            const ref = `${columnIndexToName(colIndex)}${rowIndex + 1}`;
            return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
          })
          .join("");
        return `<row r="${rowIndex + 1}">${cells}</row>`;
      })
      .join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData>${rowXml}</sheetData>
</worksheet>`;
  }

  function createZipBlob(files) {
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    const now = new Date();
    const dosTime = ((now.getHours() & 0x1f) << 11) | ((now.getMinutes() & 0x3f) << 5) | ((Math.floor(now.getSeconds() / 2) & 0x1f));
    const dosDate = (((now.getFullYear() - 1980) & 0x7f) << 9) | (((now.getMonth() + 1) & 0xf) << 5) | (now.getDate() & 0x1f);

    for (const file of files) {
      const nameBytes = encoder.encode(file.name);
      const dataBytes = encoder.encode(file.content);
      const crc = crc32(dataBytes);

      const localHeader = new Uint8Array(30 + nameBytes.length);
      const localView = new DataView(localHeader.buffer);
      localView.setUint32(0, 0x04034b50, true);
      localView.setUint16(4, 20, true);
      localView.setUint16(6, 0, true);
      localView.setUint16(8, 0, true);
      localView.setUint16(10, dosTime, true);
      localView.setUint16(12, dosDate, true);
      localView.setUint32(14, crc, true);
      localView.setUint32(18, dataBytes.length, true);
      localView.setUint32(22, dataBytes.length, true);
      localView.setUint16(26, nameBytes.length, true);
      localView.setUint16(28, 0, true);
      localHeader.set(nameBytes, 30);
      localParts.push(localHeader, dataBytes);

      const centralHeader = new Uint8Array(46 + nameBytes.length);
      const centralView = new DataView(centralHeader.buffer);
      centralView.setUint32(0, 0x02014b50, true);
      centralView.setUint16(4, 20, true);
      centralView.setUint16(6, 20, true);
      centralView.setUint16(8, 0, true);
      centralView.setUint16(10, 0, true);
      centralView.setUint16(12, dosTime, true);
      centralView.setUint16(14, dosDate, true);
      centralView.setUint32(16, crc, true);
      centralView.setUint32(20, dataBytes.length, true);
      centralView.setUint32(24, dataBytes.length, true);
      centralView.setUint16(28, nameBytes.length, true);
      centralView.setUint16(30, 0, true);
      centralView.setUint16(32, 0, true);
      centralView.setUint16(34, 0, true);
      centralView.setUint16(36, 0, true);
      centralView.setUint32(38, 0, true);
      centralView.setUint32(42, offset, true);
      centralHeader.set(nameBytes, 46);
      centralParts.push(centralHeader);

      offset += localHeader.length + dataBytes.length;
    }

    const centralOffset = offset;
    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(8, files.length, true);
    endView.setUint16(10, files.length, true);
    endView.setUint32(12, centralSize, true);
    endView.setUint32(16, centralOffset, true);
    endView.setUint16(20, 0, true);

    return new Blob([...localParts, ...centralParts, end], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
  }

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let index = 0; index < bytes.length; index += 1) {
      crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let crc = index;
      for (let bit = 0; bit < 8; bit += 1) {
        crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
      }
      table[index] = crc >>> 0;
    }
    return table;
  })();

  function imageFileToDataUrl(file) {
    if (!file.type.startsWith("image/")) {
      return Promise.reject(new Error("请上传图像文件"));
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const image = new Image();
        image.onload = () => {
          const size = 420;
          const canvas = document.createElement("canvas");
          canvas.width = size;
          canvas.height = size;
          const context = canvas.getContext("2d");
          const scale = Math.max(size / image.width, size / image.height);
          const width = image.width * scale;
          const height = image.height * scale;
          context.fillStyle = "#eee7dc";
          context.fillRect(0, 0, size, size);
          context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
          resolve(canvas.toDataURL("image/jpeg", 0.84));
        };
        image.onerror = () => reject(new Error("图像读取失败"));
        image.src = reader.result;
      };
      reader.onerror = () => reject(new Error("文件读取失败"));
      reader.readAsDataURL(file);
    });
  }

  function defaultAvatar(name) {
    const label = (name || "人").trim().slice(0, 2);
    const hash = Array.from(label).reduce((sum, char) => sum + char.charCodeAt(0), 0);
    const palettes = [
      ["#f2d6d0", "#8b3f35"],
      ["#d8e6ef", "#315f8c"],
      ["#e0ead7", "#49735a"],
      ["#f4e3b8", "#8c6d25"],
      ["#ded8eb", "#634d86"]
    ];
    const [bg, fg] = palettes[hash % palettes.length];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="420" viewBox="0 0 420 420">
      <rect width="420" height="420" rx="210" fill="${bg}"/>
      <circle cx="210" cy="162" r="76" fill="#fffdf9" opacity=".78"/>
      <path d="M82 366c18-82 78-126 128-126s110 44 128 126" fill="#fffdf9" opacity=".78"/>
      <text x="210" y="226" text-anchor="middle" font-size="86" font-family="Microsoft YaHei, Arial" font-weight="700" fill="${fg}">${xmlEscape(label)}</text>
    </svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  function avatarFor(person) {
    return person?.avatarData || person?.avatarUrl || defaultAvatar(person?.name || "");
  }

  function findPerson(id) {
    return state.characters.find((person) => person.id === id);
  }

  function samePair(a1, b1, a2, b2) {
    return (a1 === a2 && b1 === b2) || (a1 === b2 && b1 === a2);
  }

  function unique(items) {
    return Array.from(new Set(items));
  }

  function createId(prefix) {
    if (crypto?.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function round2(value) {
    return Math.round(value * 100) / 100;
  }

  function charLength(value) {
    return Array.from(String(value || "")).length;
  }

  function pctToSvg(position) {
    if (!position) return null;
    return {
      x: (position.x / 100) * SVG_W,
      y: (position.y / 100) * SVG_H
    };
  }

  function adjustLineForNodeRadii(from, to, fromRadius, toRadius) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.hypot(dx, dy) || 1;
    const ux = dx / distance;
    const uy = dy / distance;
    return {
      x1: from.x + ux * fromRadius,
      y1: from.y + uy * fromRadius,
      x2: to.x - ux * toRadius,
      y2: to.y - uy * toRadius
    };
  }

  function svgElement(name, attributes = {}) {
    const element = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attributes)) {
      element.setAttribute(key, value);
    }
    return element;
  }

  function safeSvgId(value) {
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "_");
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  function xmlEscape(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function isDataImage(value) {
    return /^data:image\//.test(String(value || ""));
  }

  function safeFileName(value) {
    return String(value || "file").replace(/[\\/:*?"<>|]/g, "_");
  }

  function columnIndexToName(index) {
    let name = "";
    let number = index + 1;
    while (number > 0) {
      const remainder = (number - 1) % 26;
      name = String.fromCharCode(65 + remainder) + name;
      number = Math.floor((number - 1) / 26);
    }
    return name;
  }

  function columnNameToIndex(name) {
    return Array.from(name).reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0) - 1;
  }

  function safeSheetName(name, index) {
    const cleaned = String(name)
      .replace(/[\[\]:*?/\\]/g, "_")
      .slice(0, 31)
      .trim();
    return cleaned || `Sheet${index + 1}`;
  }

  function normalizeZipPath(path) {
    return String(path || "")
      .replace(/^\/+/, "")
      .replace(/\\/g, "/");
  }

  function resolveZipPath(basePath, target) {
    if (target.startsWith("/")) return normalizeZipPath(target);
    const baseDir = basePath.split("/").slice(0, -1).join("/");
    const parts = `${baseDir}/${target}`.split("/");
    const stack = [];
    for (const part of parts) {
      if (!part || part === ".") continue;
      if (part === "..") stack.pop();
      else stack.push(part);
    }
    return stack.join("/");
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("图像生成失败"));
      image.src = url;
    });
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    downloadUrl(url, filename);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadUrl(url, filename) {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  function showToast(message) {
    dom.toast.textContent = message;
    dom.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      dom.toast.classList.remove("show");
    }, 3800);
  }
})();
