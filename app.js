// わが家のレシピ箱 — Firestore連携・CRUD・検索/絞り込みロジック

const recipesRef = db.collection("recipes");

// ===== state =====
let allRecipes = [];      // Firestoreから同期された全件（新着順）
let activeTagFilters = new Set();
let activeCategoryFilters = new Set();
let searchQuery = "";
let editingId = null;     // 編集中のレシピID（null = 新規登録）

// 食材カテゴリ（本人が自由に追加・削除できる。Firestore settings/categories で家族間同期）
const categoriesRef = db.collection("settings").doc("categories");
const DEFAULT_CATEGORIES = [
  { name: "豚肉", icon: "🐷" },
  { name: "牛肉", icon: "🐮" },
  { name: "鶏肉", icon: "🐔" },
  { name: "魚介", icon: "🐟" },
  { name: "野菜", icon: "🥬" },
  { name: "その他", icon: "🍽" },
];
// カテゴリの色は名前ごとに固定できない(自由に追加/削除されるため)ので、
// 表示順のインデックスに応じてこのパレットから割り当てる。
const CATEGORY_PALETTE = [
  "#e0937c", "#a8503f", "#d9a441", "#4f7f96", "#6b9c5a", "#8a8272",
  "#8a6fb3", "#c2703d", "#5a8f7b", "#b3547e", "#6f7ba8", "#a68a3f",
];
let categories = []; // Firestoreから同期される {name, icon} の配列
let selectedCategories = new Set(); // 追加/編集モーダルで選択中のカテゴリ

function categoryColor(name) {
  const idx = categories.findIndex((c) => c.name === name);
  return CATEGORY_PALETTE[idx === -1 ? 0 : idx % CATEGORY_PALETTE.length];
}

function categoryIcon(name) {
  const found = categories.find((c) => c.name === name);
  return found ? found.icon || "" : "";
}

// ===== DOM refs =====
const $ = (id) => document.getElementById(id);

const searchInput = $("searchInput");
const tagRow = $("tagRow");
const cardArea = $("cardArea");
const emptyState = $("emptyState");
const recipeCount = $("recipeCount");
const addOpenBtn = $("addOpenBtn");

const modalOverlay = $("modalOverlay");
const modalHeading = $("modalHeading");
const modalTab = $("modalTab");
const fTitle = $("fTitle");
const fUrl = $("fUrl");
const pasteBtn = $("pasteBtn");
const analyzeBtn = $("analyzeBtn");
const analyzeStatus = $("analyzeStatus");
const categoryRow = $("categoryRow");
const categoryFilterRow = $("categoryFilterRow");
const manageCategoriesBtn = $("manageCategoriesBtn");
const categoryManageOverlay = $("categoryManageOverlay");
const categoryManageList = $("categoryManageList");
const newCategoryIcon = $("newCategoryIcon");
const newCategoryName = $("newCategoryName");
const addCategoryBtn = $("addCategoryBtn");
const categoryManageCloseBtn = $("categoryManageCloseBtn");
const fTags = $("fTags");
const fMemo = $("fMemo");
const saveBtn = $("saveBtn");
const deleteBtn = $("deleteBtn");
const cancelBtn = $("cancelBtn");

const viewOverlay = $("viewOverlay");
const viewTitle = $("viewTitle");
const viewMeta = $("viewMeta");
const viewUrl = $("viewUrl");
const viewCategories = $("viewCategories");
const viewTags = $("viewTags");
const viewMemo = $("viewMemo");
const viewEditBtn = $("viewEditBtn");
const viewCloseBtn = $("viewCloseBtn");

const toast = $("toast");

let toastTimer = null;
function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 2600);
}

// ===== カテゴリチップ（Firestoreのカテゴリ一覧が変わるたびに再描画） =====
function buildCategoryChip(category) {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "category-chip";
  chip.dataset.category = category.name;
  chip.style.setProperty("--chip-color", categoryColor(category.name));
  chip.textContent = `${category.icon || ""} ${category.name}`.trim();
  return chip;
}

// モーダル内：複数選択トグル（保存対象）
function renderCategoryChips() {
  categoryRow.innerHTML = "";
  categories.forEach((category) => {
    const chip = buildCategoryChip(category);
    chip.classList.toggle("on", selectedCategories.has(category.name));
    chip.addEventListener("click", () => {
      if (selectedCategories.has(category.name)) selectedCategories.delete(category.name);
      else selectedCategories.add(category.name);
      chip.classList.toggle("on", selectedCategories.has(category.name));
    });
    categoryRow.appendChild(chip);
  });
}

// 一覧の絞り込み行：OR条件（豚肉 or 鶏肉 のように複数選ぶと該当カテゴリを含むもの全て表示）
function renderCategoryFilterRow() {
  categoryFilterRow.innerHTML = "";
  categories.forEach((category) => {
    const chip = buildCategoryChip(category);
    chip.classList.toggle("on", activeCategoryFilters.has(category.name));
    chip.addEventListener("click", () => {
      if (activeCategoryFilters.has(category.name)) activeCategoryFilters.delete(category.name);
      else activeCategoryFilters.add(category.name);
      chip.classList.toggle("on", activeCategoryFilters.has(category.name));
      renderCards();
    });
    categoryFilterRow.appendChild(chip);
  });
}

function setSelectedCategories(names) {
  selectedCategories = new Set(names || []);
  categoryRow.querySelectorAll(".category-chip").forEach((chip) => {
    chip.classList.toggle("on", selectedCategories.has(chip.dataset.category));
  });
}

// ===== カテゴリ管理モーダル（追加・削除） =====
function renderCategoryManageList() {
  categoryManageList.innerHTML = "";
  categories.forEach((category) => {
    const row = document.createElement("div");
    row.className = "category-manage-row";

    const badge = document.createElement("span");
    badge.className = "mini-category";
    badge.style.background = categoryColor(category.name);
    badge.textContent = `${category.icon || ""} ${category.name}`.trim();

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "category-remove-btn";
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", () => removeCategory(category.name));

    row.appendChild(badge);
    row.appendChild(removeBtn);
    categoryManageList.appendChild(row);
  });
}

async function saveCategories(updatedList) {
  try {
    await categoriesRef.set({ list: updatedList });
  } catch (err) {
    console.error("カテゴリ更新エラー:", err);
    showToast("カテゴリの更新に失敗しました");
  }
}

function removeCategory(name) {
  if (!confirm(`「${name}」を削除します。既存レシピの登録内容は変わりません。よろしいですか？`)) return;
  saveCategories(categories.filter((c) => c.name !== name));
}

addCategoryBtn.addEventListener("click", () => {
  const name = newCategoryName.value.trim();
  if (!name) {
    showToast("カテゴリ名を入力してください");
    return;
  }
  if (categories.some((c) => c.name === name)) {
    showToast("同じ名前のカテゴリが既にあります");
    return;
  }
  const icon = newCategoryIcon.value.trim();
  saveCategories([...categories, { name, icon }]);
  newCategoryName.value = "";
  newCategoryIcon.value = "";
});

manageCategoriesBtn.addEventListener("click", () => {
  categoryManageOverlay.hidden = false;
});
categoryManageCloseBtn.addEventListener("click", () => {
  categoryManageOverlay.hidden = true;
});
categoryManageOverlay.addEventListener("click", (e) => {
  if (e.target === categoryManageOverlay) categoryManageOverlay.hidden = true;
});

// Firestoreのカテゴリ一覧をリアルタイム同期（家族の誰かが編集すれば全員に反映）。
// ドキュメントが未作成なら初期の6カテゴリで作成する。
categoriesRef.onSnapshot(
  (doc) => {
    const list = doc.exists ? doc.data().list : null;
    if (Array.isArray(list) && list.length) {
      categories = list;
    } else {
      categories = DEFAULT_CATEGORIES;
      categoriesRef.set({ list: DEFAULT_CATEGORIES });
    }
    renderCategoryChips();
    renderCategoryFilterRow();
    renderCategoryManageList();
    renderCards();
  },
  (error) => {
    console.error("カテゴリ同期エラー:", error);
    showToast("カテゴリの取得に失敗しました");
  }
);

// ===== Firestore同期（リアルタイムリスナー） =====
recipesRef.orderBy("createdAt", "desc").onSnapshot(
  (snapshot) => {
    allRecipes = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    renderTagRow();
    renderCards();
  },
  (error) => {
    console.error("Firestore同期エラー:", error);
    showToast("データの取得に失敗しました");
  }
);

// ===== タグ絞り込みチップ =====
function renderTagRow() {
  const allTags = new Set();
  allRecipes.forEach((r) => (r.tags || []).forEach((t) => allTags.add(t)));

  tagRow.innerHTML = "";
  [...allTags].sort((a, b) => a.localeCompare(b, "ja")).forEach((tag) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "tag-chip" + (activeTagFilters.has(tag) ? " active" : "");
    chip.textContent = tag;
    chip.addEventListener("click", () => {
      if (activeTagFilters.has(tag)) activeTagFilters.delete(tag);
      else activeTagFilters.add(tag);
      renderTagRow();
      renderCards();
    });
    tagRow.appendChild(chip);
  });
}

// ===== 検索・絞り込み結果の描画 =====
function matchesFilters(recipe) {
  // カテゴリ絞り込み（OR条件。選んだカテゴリのどれか1つでも含んでいれば表示）
  if (activeCategoryFilters.size > 0) {
    const categories = recipe.category || [];
    const hasAny = [...activeCategoryFilters].some((c) => categories.includes(c));
    if (!hasAny) return false;
  }
  // タグ絞り込み（AND条件）
  if (activeTagFilters.size > 0) {
    const tags = recipe.tags || [];
    for (const filterTag of activeTagFilters) {
      if (!tags.includes(filterTag)) return false;
    }
  }
  // 検索（タイトル・タグ・メモの部分一致）
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    const haystack = [
      recipe.title || "",
      (recipe.tags || []).join(" "),
      recipe.memo || "",
    ]
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  return true;
}

function formatDate(timestamp) {
  if (!timestamp || !timestamp.toDate) return "";
  const d = timestamp.toDate();
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function renderCards() {
  const filtered = allRecipes.filter(matchesFilters);

  recipeCount.textContent = `${allRecipes.length}件のレシピ`;

  cardArea.querySelectorAll(".recipe-card").forEach((el) => el.remove());

  if (filtered.length === 0) {
    emptyState.hidden = false;
    emptyState.querySelector("p").innerHTML =
      allRecipes.length === 0
        ? "まだレシピが登録されていません。<br />「＋ 追加」から最初の1枚を書いてみましょう。"
        : "条件に合うレシピが見つかりませんでした。";
    return;
  }
  emptyState.hidden = true;

  filtered.forEach((recipe) => {
    const card = document.createElement("article");
    card.className = "recipe-card";
    card.innerHTML = `
      <div class="card-top">
        <h3 class="card-title">${escapeHtml(recipe.title || "")}</h3>
      </div>
      ${
        (recipe.category || []).length
          ? `<div class="card-categories">${recipe.category
              .map((c) => `<span class="mini-category" style="background:${categoryColor(c)}">${categoryIcon(c)} ${escapeHtml(c)}</span>`)
              .join("")}</div>`
          : ""
      }
      ${
        (recipe.tags || []).length
          ? `<div class="card-tags">${recipe.tags
              .map((t) => `<span class="mini-tag">${escapeHtml(t)}</span>`)
              .join("")}</div>`
          : ""
      }
      ${recipe.memo ? `<p class="card-memo-preview">${escapeHtml(recipe.memo)}</p>` : ""}
    `;
    card.addEventListener("click", () => openViewModal(recipe));
    cardArea.appendChild(card);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ===== 検索イベント =====
searchInput.addEventListener("input", (e) => {
  searchQuery = e.target.value.trim();
  renderCards();
});

// ===== 詳細モーダル =====
function openViewModal(recipe) {
  viewTab.textContent = "CARD";
  viewTitle.textContent = recipe.title || "";
  viewMeta.textContent = formatDate(recipe.createdAt);

  if (recipe.url) {
    viewUrl.textContent = recipe.url;
    viewUrl.href = recipe.url;
    viewUrl.hidden = false;
  } else {
    viewUrl.hidden = true;
  }

  viewCategories.innerHTML = (recipe.category || [])
    .map((c) => `<span class="mini-category" style="background:${categoryColor(c)}">${categoryIcon(c)} ${escapeHtml(c)}</span>`)
    .join("");

  viewTags.innerHTML = (recipe.tags || [])
    .map((t) => `<span class="mini-tag">${escapeHtml(t)}</span>`)
    .join("");

  viewMemo.textContent = recipe.memo || "（メモなし）";

  viewEditBtn.onclick = () => {
    closeViewModal();
    openEditModal(recipe);
  };

  viewOverlay.hidden = false;
}

function closeViewModal() {
  viewOverlay.hidden = true;
}

viewCloseBtn.addEventListener("click", closeViewModal);
viewOverlay.addEventListener("click", (e) => {
  if (e.target === viewOverlay) closeViewModal();
});

const viewTab = $("viewTab");

// ===== 追加・編集モーダル =====
function resetForm() {
  fTitle.value = "";
  fUrl.value = "";
  fTags.value = "";
  fMemo.value = "";
  setSelectedCategories([]);
}

function openAddModal() {
  editingId = null;
  modalHeading.textContent = "レシピを追加";
  modalTab.textContent = "NEW CARD";
  deleteBtn.hidden = true;
  resetForm();
  modalOverlay.hidden = false;
  fTitle.focus();
}

function openEditModal(recipe) {
  editingId = recipe.id;
  modalHeading.textContent = "レシピを編集";
  modalTab.textContent = "EDIT CARD";
  deleteBtn.hidden = false;

  fTitle.value = recipe.title || "";
  fUrl.value = recipe.url || "";
  fTags.value = (recipe.tags || []).join(", ");
  fMemo.value = recipe.memo || "";
  setSelectedCategories(recipe.category || []);

  modalOverlay.hidden = false;
  fTitle.focus();
}

function closeModal() {
  modalOverlay.hidden = true;
  editingId = null;
}

addOpenBtn.addEventListener("click", openAddModal);
cancelBtn.addEventListener("click", closeModal);
modalOverlay.addEventListener("click", (e) => {
  if (e.target === modalOverlay) closeModal();
});

// クリップボードから貼り付け
pasteBtn.addEventListener("click", async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text) fUrl.value = text.trim();
  } catch (err) {
    showToast("貼り付けできませんでした。手動で貼り付けてください");
  }
});

// ===== サイトから材料・作り方を自動解析 =====
// レシピサイトの多くはSEO用にschema.org/Recipeの構造化データ(JSON-LD)を埋め込んでいる。
// ブラウザから他サイトのHTMLを直接fetchするとCORSで弾かれるため、無料の中継プロキシを
// 複数用意し、順番に試す（1つ死んでいても次を試すフォールバック）。
const CORS_PROXIES = [
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
  (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
];

async function fetchHtmlViaProxy(url) {
  let lastErr = new Error("すべての取得経路が失敗しました");
  for (const buildProxyUrl of CORS_PROXIES) {
    try {
      const res = await fetch(buildProxyUrl(url));
      if (!res.ok) throw new Error(`status ${res.status}`);
      const html = await res.text();
      if (html && html.length > 200) return html;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

// サイトによってはJSON-LD内に "//" コメントや生の改行(制御文字)が混入しており、
// 本来はJSON仕様違反のためJSON.parseが失敗する（例: gomaabura.jp）。
// そのままでは救えないので、行コメント・ブロックコメントの除去と、文字列内の
// 生の制御文字をスペースに置き換える緩和処理をかけてから再パースを試みる。
function sanitizeJsonLdText(text) {
  const ctrlRegex = new RegExp("[" + String.fromCharCode(0) + "-" + String.fromCharCode(31) + "]+", "g");
  return text
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(ctrlRegex, " ");
}

function parseJsonLdScript(rawText) {
  try {
    return JSON.parse(rawText);
  } catch {
    try {
      return JSON.parse(sanitizeJsonLdText(rawText));
    } catch {
      return null;
    }
  }
}

// HTML内の <script type="application/ld+json"> から @type: "Recipe" を探す。
// @graph配列や複数scriptタグに分散しているケースにも対応。
function findRecipeJsonLd(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    const data = parseJsonLdScript(script.textContent);
    if (!data) continue;
    const candidates = [];
    const collect = (node) => {
      if (!node) return;
      if (Array.isArray(node)) {
        node.forEach(collect);
        return;
      }
      if (node["@graph"]) {
        collect(node["@graph"]);
        return;
      }
      candidates.push(node);
    };
    collect(data);
    const recipe = candidates.find((c) => {
      const t = c["@type"];
      return t === "Recipe" || (Array.isArray(t) && t.includes("Recipe"));
    });
    if (recipe) return recipe;
  }
  return null;
}

// recipeInstructions は string / string[] / HowToStep[] など表記ゆれが大きいので正規化する
function instructionsToLines(instructions) {
  if (!instructions) return [];
  if (typeof instructions === "string") {
    return instructions
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (Array.isArray(instructions)) {
    return instructions
      .map((step) => {
        if (typeof step === "string") return step;
        if (step.text) return step.text;
        if (step.itemListElement) return instructionsToLines(step.itemListElement).join(" ");
        return "";
      })
      .filter(Boolean);
  }
  return [];
}

function buildMemoFromRecipe(recipe, sourceUrl) {
  const lines = [];
  const ingredients = recipe.recipeIngredient || recipe.ingredients || [];
  if (ingredients.length) {
    lines.push("【材料】");
    ingredients.forEach((i) => lines.push(`・${i}`));
    lines.push("");
  }
  const steps = instructionsToLines(recipe.recipeInstructions);
  if (steps.length) {
    lines.push("【作り方】");
    steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
    lines.push("");
  }
  lines.push(`（元サイト: ${sourceUrl}）`);
  return lines.join("\n");
}

function setAnalyzeStatus(message) {
  if (!message) {
    analyzeStatus.hidden = true;
    return;
  }
  analyzeStatus.textContent = message;
  analyzeStatus.hidden = false;
}

analyzeBtn.addEventListener("click", async () => {
  const url = fUrl.value.trim();
  if (!url) {
    showToast("先に参照URLを入力してください");
    return;
  }
  if (!navigator.onLine) {
    showToast("オフラインのため解析できません");
    return;
  }

  analyzeBtn.disabled = true;
  const originalLabel = analyzeBtn.textContent;
  analyzeBtn.textContent = "🔍 解析中…";
  setAnalyzeStatus("サイトを読み込んでいます…（数秒かかることがあります）");

  try {
    const html = await fetchHtmlViaProxy(url);
    const recipe = findRecipeJsonLd(html);
    if (!recipe) {
      setAnalyzeStatus("");
      showToast("このサイトからは自動解析できませんでした。手動で入力してください");
      return;
    }

    if (recipe.name && !fTitle.value.trim()) {
      fTitle.value = recipe.name;
    }

    const memoText = buildMemoFromRecipe(recipe, url);
    if (fMemo.value.trim() && !confirm("メモ欄に既存の内容があります。解析結果で上書きしますか？")) {
      setAnalyzeStatus("");
      return;
    }
    fMemo.value = memoText;
    setAnalyzeStatus("");
    showToast("材料・作り方を自動入力しました");
  } catch (err) {
    console.error("解析エラー:", err);
    setAnalyzeStatus("");
    showToast("自動解析に失敗しました。手動で入力してください");
  } finally {
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = originalLabel;
  }
});

// 保存（新規 / 更新）
saveBtn.addEventListener("click", async () => {
  const title = fTitle.value.trim();
  if (!title) {
    showToast("料理名を入力してください");
    fTitle.focus();
    return;
  }
  if (!navigator.onLine) {
    showToast("オフラインのため保存できません");
    return;
  }

  const tags = fTags.value
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const data = {
    title,
    url: fUrl.value.trim(),
    category: [...selectedCategories],
    tags,
    memo: fMemo.value.trim(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  };

  saveBtn.disabled = true;
  try {
    if (editingId) {
      await recipesRef.doc(editingId).update(data);
      showToast("更新しました");
    } else {
      data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      await recipesRef.add(data);
      showToast("追加しました");
    }
    closeModal();
  } catch (err) {
    console.error("保存エラー:", err);
    showToast("保存に失敗しました");
  } finally {
    saveBtn.disabled = false;
  }
});

// 削除
deleteBtn.addEventListener("click", async () => {
  if (!editingId) return;
  if (!confirm("このレシピを削除します。元に戻せません。よろしいですか？")) return;
  if (!navigator.onLine) {
    showToast("オフラインのため削除できません");
    return;
  }
  try {
    await recipesRef.doc(editingId).delete();
    showToast("削除しました");
    closeModal();
  } catch (err) {
    console.error("削除エラー:", err);
    showToast("削除に失敗しました");
  }
});

// オフライン検知
window.addEventListener("offline", () => showToast("オフラインになりました（保存はできません）"));
