// わが家のレシピ箱 — Firestore連携・CRUD・検索/絞り込みロジック

const recipesRef = db.collection("recipes");

// ===== state =====
let allRecipes = [];      // Firestoreから同期された全件（新着順）
let activeTagFilters = new Set();
let activeCategoryFilters = new Set();
let searchQuery = "";
let editingId = null;     // 編集中のレシピID（null = 新規登録）
let tagRowVisible = false; // タグ絞り込み一覧の開閉状態（普段は畳んでおく）

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
let currentPhoto = ""; // 追加/編集モーダルで保持中の写真URL（レシピサイトから自動取得）

function setPhotoPreview(url) {
  currentPhoto = url || "";
  if (currentPhoto) {
    photoPreviewImg.src = currentPhoto;
    photoPreview.hidden = false;
  } else {
    photoPreviewImg.src = "";
    photoPreview.hidden = true;
  }
}

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
const tagToggleBtn = $("tagToggleBtn");
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
const photoPreview = $("photoPreview");
const photoPreviewImg = $("photoPreviewImg");
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
const viewPhoto = $("viewPhoto");
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
// タグが増えると一覧を圧迫するので、普段は畳んでおきボタンで開閉する
function updateTagToggleBtn() {
  const count = activeTagFilters.size;
  tagToggleBtn.textContent = `🏷 タグで絞り込み${count ? `（${count}）` : ""} ${tagRowVisible ? "▴" : "▾"}`;
  tagToggleBtn.classList.toggle("filtering", count > 0);
}

tagToggleBtn.addEventListener("click", () => {
  tagRowVisible = !tagRowVisible;
  tagRow.hidden = !tagRowVisible;
  updateTagToggleBtn();
});

function renderTagRow() {
  const allTags = new Set();
  allRecipes.forEach((r) => (r.tags || []).forEach((t) => allTags.add(t)));

  // タグが1つも無ければ開閉ボタンごと隠す
  tagToggleBtn.hidden = allTags.size === 0;
  updateTagToggleBtn();

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

// URLから出典の種類を判定してバッジ用の絵文字を返す（YouTube / Instagram / Webサイト）
function sourceBadge(url) {
  if (!url) return "";
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host === "youtu.be" || host.endsWith("youtube.com")) return "▶";
    if (host.endsWith("instagram.com")) return "📷";
    return "🔗";
  } catch {
    return "🔗";
  }
}

function showTilePlaceholder(photoWrap) {
  const placeholder = document.createElement("span");
  placeholder.className = "tile-photo-placeholder";
  placeholder.textContent = "🍽️";
  photoWrap.appendChild(placeholder);
}

function renderCards() {
  const filtered = allRecipes.filter(matchesFilters);

  recipeCount.textContent =
    filtered.length === allRecipes.length
      ? `${allRecipes.length}件のレシピ`
      : `${filtered.length}件を表示中（全${allRecipes.length}件）`;

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

    const photoWrap = document.createElement("div");
    photoWrap.className = "tile-photo";
    if (recipe.photo) {
      const img = document.createElement("img");
      img.className = "tile-img";
      img.loading = "lazy";
      img.alt = "";
      img.addEventListener("error", () => {
        img.remove();
        showTilePlaceholder(photoWrap);
      });
      img.src = recipe.photo;
      photoWrap.appendChild(img);
    } else {
      showTilePlaceholder(photoWrap);
    }
    card.appendChild(photoWrap);

    const badge = sourceBadge(recipe.url);
    if (badge) {
      const badgeEl = document.createElement("span");
      badgeEl.className = "tile-badge";
      badgeEl.textContent = badge;
      card.appendChild(badgeEl);
    }

    const titleBar = document.createElement("div");
    titleBar.className = "tile-title-bar";
    const title = document.createElement("h3");
    title.className = "tile-title";
    title.textContent = recipe.title || "";
    titleBar.appendChild(title);
    card.appendChild(titleBar);

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

  if (recipe.photo) {
    viewPhoto.src = recipe.photo;
    viewPhoto.hidden = false;
  } else {
    viewPhoto.src = "";
    viewPhoto.hidden = true;
  }

  if (recipe.url) {
    let host = "";
    try {
      host = new URL(recipe.url).hostname.replace(/^www\./, "");
    } catch {}
    let label = "元のレシピを見る";
    if (host === "youtu.be" || host.endsWith("youtube.com")) label = "▶ YouTubeで見る";
    else if (host.endsWith("instagram.com")) label = "📷 Instagramで見る";
    else if (host) label = `🔗 ${host} でレシピを見る`;
    viewUrl.textContent = label;
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
  setPhotoPreview("");
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
  setPhotoPreview(recipe.photo || "");

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

const FETCH_TIMEOUT_MS = 10000;

async function fetchViaProxy(targetUrl, buildProxyUrl) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(buildProxyUrl(targetUrl), { signal: ctrl.signal });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const html = await res.text();
    if (!html || html.length <= 200) throw new Error("empty response");
    return html;
  } finally {
    clearTimeout(timer);
  }
}

// レシピデータの抽出: JSON-LD → Next.js(__NEXT_DATA__) → OGPタグ の順に試す
function extractRecipeFromHtml(html) {
  return findRecipeJsonLd(html) || findNextDataRecipe(html) || findOgFallback(html);
}

// サイトによっては中継プロキシからのアクセスをブロックしている(例: レタスクラブ)。
// その場合はWayback Machine(web.archive.org)に保存されたコピーをプロキシ経由で取得する。
// 「2id_」はリダイレクトで最新スナップショットの原本HTMLに飛ぶ特殊URL。
async function fetchRecipeData(url) {
  const attempts = [
    { target: url, label: "サイトを読み込んでいます…" },
    { target: `https://web.archive.org/web/2id_/${url}`, label: "保存されたコピー(アーカイブ)から取得しています…" },
  ];
  let partial = null;
  for (const { target, label } of attempts) {
    setAnalyzeStatus(`${label}（数秒かかることがあります）`);
    for (const buildProxyUrl of CORS_PROXIES) {
      let html;
      try {
        html = await fetchViaProxy(target, buildProxyUrl);
      } catch {
        continue;
      }
      const recipe = extractRecipeFromHtml(html);
      if (recipe && !recipe.partial) return recipe;
      if (recipe && !partial) partial = recipe; // タイトル・写真のみの結果は保持しつつ、より良い結果を探し続ける
    }
  }
  return partial;
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

// HTMLタグを除去してテキストだけ取り出す(手順の説明文に<a>リンク等が混ざるサイト対策)。
// DOMParserは画像読み込みやスクリプト実行をしないので、外部HTML由来の文字列でも安全。
function stripHtml(html) {
  return new DOMParser().parseFromString(html, "text/html").body.textContent.trim();
}

// Nadia(oceans-nadia.com)はJSON-LDを持たないNext.js製サイトで、レシピデータは
// <script id="__NEXT_DATA__"> のJSONに入っている。そこから取り出して
// schema.org/Recipe相当の形に正規化する。
function findNextDataRecipe(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const script = doc.getElementById("__NEXT_DATA__");
  if (!script) return null;
  let data;
  try {
    data = JSON.parse(script.textContent);
  } catch {
    return null;
  }
  const r =
    data && data.props && data.props.pageProps && data.props.pageProps.data
      ? data.props.pageProps.data.publishedRecipe
      : null;
  if (!r || !r.title) return null;

  const ingredients = (r.ingredients || [])
    .map((i) => [i.kubun ? `(${i.kubun})` : "", i.name, i.amount].filter(Boolean).join(" ").trim())
    .filter(Boolean);
  const steps = (r.instructions || [])
    .slice()
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
    .map((s) => stripHtml(s.comment || ""))
    .filter(Boolean);
  const imagePath = r.imageSet && r.imageSet[0] && r.imageSet[0].path;

  return {
    name: r.title,
    image: imagePath ? `https://asset.oceans-nadia.com${imagePath}` : "",
    recipeIngredient: ingredients,
    recipeInstructions: steps,
    recipeYield: r.bunryoPeople ? `${r.bunryoPeople}人分` : r.yield || "",
    cookTimeText: r.cookTime ? `${r.cookTime}分` : "",
    tips: r.tips || "",
    keywords: (r.sortedTags || []).map((t) => t.name).filter(Boolean),
  };
}

// 構造化データが一切ないサイト向けの最終手段: OGPタグからタイトルと写真だけ拾う。
// <title>までは見ない(プロキシのエラーページ等を誤って拾わないため、og:title必須)。
function findOgFallback(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const og = (p) => {
    const meta = doc.querySelector(`meta[property="og:${p}"]`);
    return meta ? meta.getAttribute("content") || "" : "";
  };
  const name = og("title").trim();
  if (!name) return null;
  return { name, image: og("image"), partial: true };
}

// schema.orgのtotalTime等はISO 8601 duration(例: PT1H10M)で入っていることが多い
function durationToText(value) {
  if (!value || typeof value !== "string") return "";
  const m = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!m || (!m[1] && !m[2])) return "";
  return `${m[1] ? `${m[1]}時間` : ""}${m[2] ? `${m[2]}分` : ""}`;
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

// schema.org/Recipeのimageは string / string[] / ImageObject / ImageObject[] など表記ゆれが大きい
function extractImageUrl(recipe) {
  const img = recipe.image;
  if (!img) return "";
  if (typeof img === "string") return img;
  if (Array.isArray(img)) {
    const first = img[0];
    if (typeof first === "string") return first;
    if (first && first.url) return first.url;
    return "";
  }
  if (img.url) return img.url;
  return "";
}

function buildMemoFromRecipe(recipe, sourceUrl) {
  const lines = [];

  const info = [];
  const yieldText = Array.isArray(recipe.recipeYield) ? recipe.recipeYield[0] : recipe.recipeYield;
  if (yieldText) info.push(`分量: ${yieldText}`);
  const timeText = recipe.cookTimeText || durationToText(recipe.totalTime || recipe.cookTime);
  if (timeText) info.push(`調理時間: ${timeText}`);
  if (info.length) {
    lines.push(info.join(" ／ "));
    lines.push("");
  }

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
  if (recipe.tips) {
    lines.push("【コツ・ポイント】");
    lines.push(recipe.tips);
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
    const recipe = await fetchRecipeData(url);
    if (!recipe) {
      setAnalyzeStatus("");
      showToast("このサイトからは自動解析できませんでした。手動で入力してください");
      return;
    }

    if (recipe.name && !fTitle.value.trim()) {
      fTitle.value = recipe.name;
    }

    const imageUrl = extractImageUrl(recipe);
    if (imageUrl && !currentPhoto) {
      setPhotoPreview(imageUrl);
    }

    // タグ欄が空なら、サイト側のタグ/キーワードを自動で入れる
    const kw = recipe.keywords;
    const tagList = Array.isArray(kw)
      ? kw
      : typeof kw === "string"
        ? kw.split(",").map((s) => s.trim()).filter(Boolean)
        : [];
    if (tagList.length && !fTags.value.trim()) {
      fTags.value = tagList.slice(0, 5).join(", ");
    }

    if (recipe.partial) {
      // タイトル・写真のみ取得できた場合はメモ欄には触らない
      setAnalyzeStatus("");
      showToast("材料は取得できませんでしたが、タイトルと写真を入力しました");
      return;
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
    photo: currentPhoto,
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
