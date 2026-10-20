// 設定：暱稱、對弈輔助、鍵盤翻棋譜的方向

import { useState } from "react";
import { MAX_NAME_LENGTH } from "./protocol";
import { renameMe, saveName } from "./net";
import { type Settings, updateSettings, useSettings } from "./settings";
import { SheetPage } from "./SheetPage";
import { AUTHOR, YEAR } from "./credits";

type Props = {
  name: string;
  loggedIn: boolean; // 登入的話暱稱也存到帳號
  onNameSaved: (name: string) => void;
  notice?: string; // 例如從大廳因為沒暱稱被帶過來：「連線對戰前先取個暱稱」，游標直接放在暱稱
  onExit: () => void;
};

export function SettingsPage({ name, loggedIn, onNameSaved, notice, onExit }: Props) {
  const settings = useSettings();
  const [draft, setDraft] = useState(name);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const trimmed = draft.trim();
  const changed = trimmed !== name.trim();

  const saveNickname = async () => {
    if (!trimmed || !changed) return;
    setStatus("saving");
    const saved = loggedIn ? await renameMe(trimmed) : trimmed;
    if (saved === null) {
      setStatus("failed");
      return;
    }
    saveName(saved);
    setDraft(saved);
    onNameSaved(saved);
    setStatus("saved");
  };

  const toggle = (key: keyof Settings) => updateSettings({ [key]: !settings[key] });

  return (
    <SheetPage title="設定" onExit={onExit}>
      <section className="sheet-section">
        <h2>暱稱</h2>
        {notice && <p style={{ color: "var(--vermilion)" }}>{notice}</p>}
        <form
          className="field"
          onSubmit={(e) => {
            e.preventDefault();
            saveNickname();
          }}
        >
          <input
            type="text"
            value={draft}
            maxLength={MAX_NAME_LENGTH}
            autoFocus={!!notice}
            onChange={(e) => {
              setDraft(e.target.value);
              setStatus("idle");
            }}
            placeholder="輸入你的暱稱"
            aria-label="暱稱"
          />
          <button className="sheet-button" type="submit" disabled={!trimmed || !changed || status === "saving"}>
            儲存
          </button>
        </form>
        <p className="note" role="status">
          {status === "saved"
            ? "已儲存"
            : status === "failed"
            ? "儲存失敗，請再試一次"
            : loggedIn
            ? "連線對局裡別人看到的名字，也會存到你的帳號"
            : `連線對局裡別人看到的名字，最多 ${MAX_NAME_LENGTH} 個字`}
        </p>
      </section>

      <section className="sheet-section">
        <h2>對弈輔助</h2>
        <Choice
          checked={settings.showTargets}
          onChange={() => toggle("showTargets")}
          label="標出可以走的位置"
          hint="選子後，能走的點標綠點、能吃的子畫圈"
        />
        <Choice
          checked={settings.showLastMove}
          onChange={() => toggle("showLastMove")}
          label="標出上一步"
          hint="棋子從哪裡走到哪裡，畫一個箭頭"
        />
        <Choice
          checked={settings.showTerritory}
          onChange={() => toggle("showTerritory")}
          label="地盤底色"
          hint="三家的地盤各塗一層淡淡的己方顏色"
        />
      </section>

      <section className="sheet-section">
        <h2>鍵盤翻棋譜</h2>
        <Choice
          type="radio"
          checked={settings.arrowLeftIsNext}
          onChange={() => updateSettings({ arrowLeftIsNext: true })}
          label="← 下一步、→ 上一步"
          hint="跟棋譜一樣由右往左讀"
        />
        <Choice
          type="radio"
          checked={!settings.arrowLeftIsNext}
          onChange={() => updateSettings({ arrowLeftIsNext: false })}
          label="← 上一步、→ 下一步"
        />
        <p className="note">這些設定存在這台電腦的瀏覽器裡，換電腦要再設一次。</p>
      </section>

      <section className="sheet-section">
        <h2>關於</h2>
        <p>三垣・三人象棋</p>
        <p className="note">
          © {YEAR} {AUTHOR}{"　"}版權所有，翻印必究
        </p>
        <p className="note">
          字型：霞鶩文楷 TC（LXGW WenKai TC）、Noto Serif TC，皆以 SIL Open Font License 1.1 授權
        </p>
      </section>
    </SheetPage>
  );
}

function Choice({
  type = "checkbox",
  checked,
  onChange,
  label,
  hint,
}: {
  type?: "checkbox" | "radio";
  checked: boolean;
  onChange: () => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="choice">
      <input type={type} name={type === "radio" ? "arrow-keys" : undefined} checked={checked} onChange={onChange} />
      <span>
        {label}
        {hint && <span className="note">{hint}</span>}
      </span>
    </label>
  );
}
