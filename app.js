// わが家のレシピ箱 — Firestore連携・CRUD・検索/絞り込みロジック

const recipesRef = db.collection("recipes");

// ===== state =====
let allRecipes = [];      // Firestoreから同期された全件（新着順）
let activeTagFilters = new Set();
let searchQuery = "";
let editingId = null;     // 編集中のレシピID（null = 新規登録）

const LAST_WHO_KEY = "recipeBox.lastWho";

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
const whoRow = $("whoRow");
const fTags = $("fTags");
const fMemo = $("fMemo");
const saveBtn = $("saveBtn");
const deleteBtn = $("deleteBtn");
const cancelBtn = $("cancelBtn");

const viewOverlay = $("viewOverlay");
const viewTitle = $("viewTitle");
const viewMeta = $("viewMeta");
const viewUrl = $("viewUrl");
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
      <span class="card-tab">${escapeHtml(recipe.who || "")}が登録</span>
      <div class="card-top">
        <h3 class="card-title">${escapeHtml(recipe.title || "")}</h3>
        <span class="who-chip-mini" data-who="${escapeHtml(recipe.who || "")}">${escapeHtml(recipe.who || "")}</span>
      </div>
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
  viewMeta.textContent = `${recipe.who || ""}が登録・${formatDate(recipe.createdAt)}`;

  if (recipe.url) {
    viewUrl.textContent = recipe.url;
    viewUrl.href = recipe.url;
    viewUrl.hidden = false;
  } else {
    viewUrl.hidden = true;
  }

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
  const lastWho = localStorage.getItem(LAST_WHO_KEY) || "久詞";
  setSelectedWho(lastWho);
}

function setSelectedWho(who) {
  whoRow.querySelectorAll(".who-chip").forEach((chip) => {
    chip.classList.toggle("selected", chip.dataset.who === who);
  });
}

function getSelectedWho() {
  const selected = whoRow.querySelector(".who-chip.selected");
  return selected ? selected.dataset.who : "久詞";
}

whoRow.querySelectorAll(".who-chip").forEach((chip) => {
  chip.addEventListener("click", () => setSelectedWho(chip.dataset.who));
});

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
  setSelectedWho(recipe.who || "久詞");

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

  const who = getSelectedWho();
  localStorage.setItem(LAST_WHO_KEY, who);

  const tags = fTags.value
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const data = {
    title,
    url: fUrl.value.trim(),
    who,
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
