import { clearSessionCookie, createSessionCookie, json, readJson, secureEqual, type PagesHandler } from "../../_shared";

export const onRequestPost: PagesHandler = async ({ request, env }) => {
  try {
    const body = await readJson<{ password?: unknown }>(request, 2_000);
    const password = typeof body.password === "string" ? body.password : "";
    if (!env.ADMIN_PASSWORD || !env.ADMIN_SESSION_SECRET) return json({ error: "后台认证尚未配置" }, 503);
    if (!(await secureEqual(password, env.ADMIN_PASSWORD))) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return json({ error: "密码不正确" }, 401);
    }
    return json({ authenticated: true }, 200, { "set-cookie": await createSessionCookie(env.ADMIN_SESSION_SECRET) });
  } catch {
    return json({ error: "登录请求无效" }, 400);
  }
};

export const onRequestDelete: PagesHandler = () => json(
  { authenticated: false },
  200,
  { "set-cookie": clearSessionCookie() },
);
