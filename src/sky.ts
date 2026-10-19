// 星象：二十八宿每一輪推進一宿，所在的四象會改變某些棋子的走法
//
// 一輪 = 還在場上的每一家各輪到一次。四象照二十八宿的傳統順序輪轉：
//   東方青龍（角～箕）→ 北方玄武（斗～壁）→ 西方白虎（奎～參）→ 南方朱雀（井～軫）
// 天象只由輪數決定，伺服器、客戶端、電腦與回放都算得出同一個結果。

export type Phase = "dragon" | "tortoise" | "tiger" | "bird";

export const MANSIONS = [
  "角", "亢", "氐", "房", "心", "尾", "箕",
  "斗", "牛", "女", "虛", "危", "室", "壁",
  "奎", "婁", "胃", "昴", "畢", "觜", "參",
  "井", "鬼", "柳", "星", "張", "翼", "軫",
];

const PHASE_ORDER: Phase[] = ["dragon", "tortoise", "tiger", "bird"];
const MANSIONS_PER_PHASE = MANSIONS.length / PHASE_ORDER.length;

export const PHASE_INFO: Record<
  Phase,
  { name: string; color: string; effect: string }
> = {
  dragon: { name: "東方青龍", color: "#34d399", effect: "馬不蹩腳" },
  tortoise: {
    name: "北方玄武",
    color: "#94a3b8",
    effect: "相象可過河；降士可出宮",
  },
  tiger: { name: "西方白虎", color: "#e5e7eb", effect: "未過河的兵也能橫走" },
  bird: { name: "南方朱雀", color: "#f87171", effect: "炮須隔兩子才能吃" },
};

// 開局隨機從某一宿開始，所以天象不一定從青龍開始
export const randomSkyStart = () => Math.floor(Math.random() * MANSIONS.length);

// 以下的 round 都是從角宿算起的宿數（開局的宿 + 第幾輪）
export const mansionAt = (round: number) => MANSIONS[round % MANSIONS.length];

export const phaseAt = (round: number): Phase =>
  PHASE_ORDER[Math.floor((round % MANSIONS.length) / MANSIONS_PER_PHASE)];

// 從 round 起算，目前四象還剩幾輪（含這一輪）
export const roundsLeftInPhase = (round: number) =>
  MANSIONS_PER_PHASE - ((round % MANSIONS.length) % MANSIONS_PER_PHASE);

export const nextPhase = (phase: Phase): Phase =>
  PHASE_ORDER[(PHASE_ORDER.indexOf(phase) + 1) % PHASE_ORDER.length];
