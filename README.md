# わが家のレシピ箱

久詞さん・娘さん・息子さんの家族3人でレシピを共有するミニアプリ。フレームワーク不要（素のHTML/CSS/JS）、データはFirebase Firestoreでリアルタイム同期、GitHub Pagesで公開してiPhoneの「ホーム画面に追加」からアプリのように使う。

**セキュリティルール：現在は (a) オープン運用**（誰でも読み書き可）。URLを家族以外に教えなければ実用上問題ない前提。将来、認証ありに強化することも可能。

---

## 1. Firebaseプロジェクトの作り方

1. https://console.firebase.google.com を開き、Googleアカウントでログイン。
2. 「プロジェクトを追加」→ プロジェクト名を入力（例：`recipe-box`）→ 作成。
3. プロジェクトのトップ画面で「</>」（ウェブアプリを追加）のアイコンをクリック。
4. アプリのニックネームを入力（例：`recipe-app`）→ 「Firebase Hosting」は使わないのでチェック不要 → 「アプリを登録」。
5. 表示される `firebaseConfig` の中身（apiKey / authDomain / projectId / storageBucket / messagingSenderId / appId）をコピーしておく（次の章で使う）。

## 2. Firestore Databaseの有効化

1. 左メニュー「構築」→「Firestore Database」→「データベースの作成」。
2. ロケーションを選択（例：`asia-northeast1`（東京））。
3. **モードの選択**：
   - 「テストモード」：30日間は誰でも読み書き可（期限切れで動かなくなる）
   - 「本番環境モード」：デフォルトで全拒否（自分でルールを書く必要あり）
   - **今回の推奨：本番環境モードを選び、下記のルールを手動で設定する**（期限切れの心配がなく、意図が明確）。
4. データベース作成後、「ルール」タブを開き、以下に置き換えて「公開」：

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /recipes/{recipeId} {
         allow read, write: if true;
       }
     }
   }
   ```

   ※ これは「(a) オープン運用」の設定。誰でも読み書きできるため、このアプリのURLは家族以外に共有しないこと。

## 3. `firebase-config.js` への値の貼り付け方

`firebase-config.js` を開き、`"ここに貼り付け"` の部分を、1章でコピーした値に置き換える。

```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "recipe-box-xxxx.firebaseapp.com",
  projectId: "recipe-box-xxxx",
  storageBucket: "recipe-box-xxxx.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:xxxxxxxx"
};
```

保存すればOK（この値は公開されて問題ないクライアント設定値で、パスワードではない）。

## 4. GitHub Pagesへのデプロイ手順

既存のシフト管理アプリ・買い物リストアプリと同じ手順。

1. GitHubで新しいリポジトリを作成（リポジトリ名：`recipe-app`、公開設定：Public）。
2. このフォルダの中身一式（`index.html` / `style.css` / `app.js` / `firebase-config.js` / `manifest.json` / `icon.png` / `README.md`）をリポジトリにpush。
3. リポジトリの「Settings」→「Pages」を開く。
4. 「Source」を `Deploy from a branch` にし、Branch を `main` / `/(root)` に設定して保存。
5. 数分待つと `https://（GitHubユーザー名）.github.io/recipe-app/` でアプリにアクセスできるようになる。

## 5. iPhoneでの「ホーム画面に追加」手順

1. iPhoneのSafariで、4章で確認したURLを開く。
2. 画面下部の「共有」ボタン（□に↑のアイコン）をタップ。
3. メニューを下にスクロールし「ホーム画面に追加」をタップ。
4. 名前を確認して「追加」。ホーム画面に「レシピ箱」アイコンが追加され、アプリのように起動できる。

---

## ファイル構成

```
recipe-app/
├── index.html          # 画面構造
├── style.css            # レシピカード風UI（罫線ノート＋インデックスタブ）
├── app.js                # Firestore連携・CRUD・検索/絞り込みロジック
├── firebase-config.js   # Firebase設定（要・値の貼り付け）
├── manifest.json         # ホーム画面追加用
├── icon.png              # アプリアイコン（仮アイコン）
└── README.md
```

## 今回のスコープ外（将来フェーズ）

レシピ本の写真からのOCR取り込み／献立作成機能／買い物リストの自動生成／ログイン認証機能。
