// PayPal（Orders v2）：建立訂單 → 玩家到 PayPal 同意付款 → 帶回來時由伺服器請款（capture）。
// 請款成功才算付款完成；玩家同意後沒回到網站就不會扣款，所以不需要 webhook。

export type PayPalConfig = {
  clientId: string;
  clientSecret: string;
  live: boolean; // false 用 sandbox
  fetch?: typeof fetch; // 測試時換成假的
};

export type PayPalOrderInput = {
  id: string; // 我們的訂單編號，存在 custom_id
  amount: string; // 例如 "3.49"
  currency: string;
  description: string;
  returnUrl: string;
  cancelUrl: string;
};

export type PayPalCapture = {
  completed: boolean; // 款項確定入帳
  customId: string | null;
  amount: string;
  currency: string;
  captureId: string;
};

type Link = { rel: string; href: string };
type CaptureBody = {
  status?: string;
  purchase_units?: {
    payments?: {
      captures?: {
        id: string;
        status: string;
        custom_id?: string;
        amount: { currency_code: string; value: string };
      }[];
    };
  }[];
};

export function createPayPal(config: PayPalConfig) {
  const fetchFn = config.fetch ?? fetch;
  const base = config.live ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
  let token: { value: string; expiresAt: number } | null = null;

  async function accessToken(): Promise<string> {
    if (token && token.expiresAt > Date.now() + 60_000) return token.value;
    const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
    const res = await fetchFn(`${base}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) throw new Error(`PayPal 取得 token 失敗：${res.status} ${await res.text()}`);
    const data = (await res.json()) as { access_token: string; expires_in: number };
    token = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
    return token.value;
  }

  async function post<T>(path: string, body: unknown, requestId?: string): Promise<T> {
    const res = await fetchFn(`${base}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await accessToken()}`,
        "Content-Type": "application/json",
        // 同一個 id 重送時 PayPal 回第一次的結果，不會重複請款
        ...(requestId ? { "PayPal-Request-Id": requestId } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`PayPal ${path} 失敗：${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }

  return {
    // 建立訂單，回傳 PayPal 的 order id 和要把玩家送去的同意付款網址
    async createOrder(input: PayPalOrderInput): Promise<{ orderId: string; approveUrl: string }> {
      const order = await post<{ id: string; links: Link[] }>(
        "/v2/checkout/orders",
        {
          intent: "CAPTURE",
          purchase_units: [
            {
              custom_id: input.id,
              invoice_id: input.id,
              description: input.description,
              amount: { currency_code: input.currency, value: input.amount },
            },
          ],
          payment_source: {
            paypal: {
              experience_context: {
                brand_name: "Three Kingdoms Chess",
                user_action: "PAY_NOW",
                shipping_preference: "NO_SHIPPING",
                return_url: input.returnUrl,
                cancel_url: input.cancelUrl,
              },
            },
          },
        },
        `create-${input.id}`
      );
      const approve = order.links.find((l) => l.rel === "payer-action" || l.rel === "approve");
      if (!approve) throw new Error(`PayPal 訂單 ${order.id} 沒有付款網址`);
      return { orderId: order.id, approveUrl: approve.href };
    },

    // 玩家同意付款後請款
    async captureOrder(orderId: string): Promise<PayPalCapture> {
      const body = await post<CaptureBody>(
        `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
        {},
        `capture-${orderId}`
      );
      const capture = body.purchase_units?.[0]?.payments?.captures?.[0];
      if (!capture) throw new Error(`PayPal 訂單 ${orderId} 請款後沒有 capture`);
      return {
        completed: body.status === "COMPLETED" && capture.status === "COMPLETED",
        customId: capture.custom_id ?? null,
        amount: capture.amount.value,
        currency: capture.amount.currency_code,
        captureId: capture.id,
      };
    },
  };
}

export type PayPal = ReturnType<typeof createPayPal>;
