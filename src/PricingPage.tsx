// 訂閱與客服：賣什麼、多少錢、怎麼收費、退款與客服信箱（不用登入就看得到，網址 /pricing）。
// 價格只列台幣（藍新）

import { type Plan, PLAN_NAMES, formatPrice } from "./protocol";
import { SUPPORT_EMAIL } from "./credits";
import { SheetPage } from "./SheetPage";

const PLANS: { plan: Plan; period: string }[] = [
  { plan: "monthly", period: "1 個月" },
  { plan: "yearly", period: "12 個月" },
];

export function PricingPage({ onExit }: { onExit: () => void }) {
  return (
    <SheetPage title="訂閱與客服" onExit={onExit}>
      <section className="sheet-section">
        <h2>服務內容</h2>
        <p>三垣是三人同盤對弈的線上象棋。單機、開房、積分配對都免費，不用付費也能玩。</p>
        <p>
          付費項目只有「訂閱」：登入後可以不限次數打開自己的棋譜復盤。免費帳號每天可以打開三局（台灣時間午夜重置）。
        </p>
      </section>

      <section className="sheet-section">
        <h2>價格</h2>
        <div className="price-table-wrap">
          <table className="price-table">
            <thead>
              <tr>
                <th scope="col">方案</th>
                <th scope="col">期間</th>
                <th scope="col">價格（新台幣）</th>
              </tr>
            </thead>
            <tbody>
              {PLANS.map(({ plan, period }) => (
                <tr key={plan}>
                  <th scope="row">{PLAN_NAMES[plan]}</th>
                  <td>{period}</td>
                  <td>{formatPrice("newebpay", plan)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="sheet-section">
        <h2>收費方式</h2>
        <ul className="sheet-list">
          <li>每次付款買一期，一次付清。不會自動續約、不會自動扣款；到期後沒有再買，就回到免費帳號。</li>
          <li>訂閱中再買一期，會從原本的到期日往後延。</li>
          <li>以新台幣計價，用信用卡經藍新金流付款。卡號由金流公司處理，本站不經手、不儲存。</li>
          <li>購買方式：用 Google 帳號登入後，到「個人資料」的「訂閱」選方案付款。付款完成後立即生效，到期日寫在「個人資料」裡。</li>
        </ul>
      </section>

      <section className="sheet-section">
        <h2>退款</h2>
        <ul className="sheet-list">
          <li>訂閱是線上提供的數位內容，付款後立即開通，開通後不提供七日鑑賞期退款。</li>
          <li>重複付款、扣款後訂閱沒有生效，或其他付款問題，請來信告訴我們，查明後全額退款。</li>
        </ul>
      </section>

      <section className="sheet-section">
        <h2>客服</h2>
        <p>
          客服信箱：
          <a className="sheet-link" href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>
        </p>
        <p className="note">付款相關的問題，請附上登入用的 Google 信箱、付款時間與金額，方便我們查詢。</p>
      </section>
    </SheetPage>
  );
}
