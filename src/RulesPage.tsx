// 規則：跟大廳一樣直書，由右往左讀，一節一欄（內容要跟 rules.ts、game.ts、sky.ts、clock.ts、rank.ts 一致）

import "./pages.css";

const SECTIONS: { title: string; items: string[] }[] = [
  {
    title: "三家與棋盤",
    items: [
      "三人各據一片棋盤，三片在中央相接，交界就是河。",
      "每片棋盤靠中央那一排的左右兩半，各面對一家鄰居；中路兩邊都能過。",
      "每家的棋子跟象棋一樣：車、馬、相、士各二，將一，炮二，兵五。",
      "紅方先走，依紅、藍、黑的順序輪流，在畫面上是逆時針。",
    ],
  },
  {
    title: "走法",
    items: [
      "車直走，格數不限。",
      "馬走日字，馬腳被擋住不能走。",
      "相走田字，象眼被塞住不能走，也不能過河。",
      "士、將只能在自己的九宮裡走。",
      "炮的走法跟車一樣，吃子要隔一子。",
      "兵沒過河只能往前；過河之後往那一家的底線走，也能橫走。",
    ],
  },
  {
    title: "出局與勝負",
    items: [
      "不能送將：走完之後，自己的將不能被任何一家吃到。",
      "將被吃掉的一家出局，剩下的棋子全部歸吃將的人。接收來的兵照原主人的方向走；接收來的士稱為降士。",
      "輪到的人無棋可走（被將死或困斃）就跳過，直到他的將真的被吃掉。",
      "場上只剩一家就獲勝；所有人都沒棋可走則和局。",
      "長將、長捉：同一局面第三次出現時，一直在將軍或捉子的人必須變著；沒人長打或人人長打則判和。",
    ],
  },
  {
    title: "天象",
    items: [
      "二十八宿每一輪推進一宿，七宿為一象，依東方青龍、北方玄武、西方白虎、南方朱雀輪轉。開局從隨機的一宿開始。",
      "每一家都用自己走棋那一輪的四象。",
      "青龍：馬不蹩腳。",
      "玄武：相可過河；降士可出宮，出宮之後一直能在宮外斜走一格。",
      "白虎：沒過河的兵也能橫走。",
      "朱雀：可連走兩步；第一步吃了別家的子或將軍別家，就只走這一步。",
      "單機可以關掉天象，改用古典規則；連線對局都有天象。",
    ],
  },
  {
    title: "密談",
    items: [
      // 全形字母數字：直書時才是正的
      "每家開局站在Ｂ５的兵是使節。",
      "任一家的使節走進另一家的棋盤，這兩家之間就能密談，第三家看不到。",
      "兩家之中有人出局，密談就關閉。",
    ],
  },
  {
    title: "計時",
    items: [
      "每人局時二十分鐘，只在輪到自己時扣。",
      "局時用完之後，每一步要在九十秒內走完；讀秒也用完，由電腦代走一步。",
    ],
  },
  {
    title: "積分配對",
    items: [
      "只有積分配對的對局會改變積分。",
      "三人拆成兩兩比較：名次在前的算贏，同名次算和；中途離開的人排最後。",
      "段位由青銅、白銀、黃金、白金、鑽石、大師到菁英，每段分Ⅰ、Ⅱ、Ⅲ，每一小段一百分。前十局升降得比較快。",
    ],
  },
];

export function RulesPage({ onExit }: { onExit: () => void }) {
  return (
    <div
      className="sheet rules-page"
      // 直書的頁面是左右捲：滑鼠滾輪往下就往左（往後讀）
      onWheel={(e) => {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft -= e.deltaY;
      }}
    >
      <button className="sheet-back" onClick={onExit}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
          <path d="M10 3L5 8L10 13" fill="none" stroke="currentColor" strokeWidth="1.8" />
        </svg>
        回大廳
      </button>
      <article className="rules">
        <h1 className="rules-title">規則</h1>
        {SECTIONS.map((s) => (
          <section key={s.title} className="rules-section">
            <h2>{s.title}</h2>
            <ul>
              {s.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ))}
      </article>
    </div>
  );
}
