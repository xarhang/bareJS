import { BareJS } from '../src/core/bare';
import { AuthController } from './controllers/AuthController';
import { bareAuth } from '../src/security/auth';
import type { Context } from '../src/core/context';
import { secrets } from 'bun';
import { BareRouter } from '../src/core/router';
import { logger } from '../src/utils/logger';
const app = new BareJS();
const api = new BareRouter("/api");
const secret = process.env.JWT_SECRET || "default_secret";
app.get("/", (ctx: Context) => {
  return ctx.json({ message: "Welcome to BareJS API" });
});
app.use(async (ctx: Context, next: any) => {
  await next();
  if (!ctx._headers) ctx._headers = {};
  ctx._headers["x-response-time"] = "1.53ms";
});
app.get("/bomb", (ctx: Context) => {
  //force error
  return (this as any).doesNotExist(); 
});
api.group("/v1", (v1: any) => {

  // 🚪 Public Routes
  v1.group("/auth", (auth: any) => {
    auth.post("/login", AuthController.login);
  });

  // 🔒 Protected Routes
  v1.group("/admin", bareAuth(secret), (admin: BareRouter) => {
    admin.get("/dashboard", (ctx: Context) => {
      const user = ctx.get('user'); // Authenticated user from context
      return ctx.json({ message: `Welcome ${user.username}` });
    });

    admin.get("/profile", AuthController.getProfile);
    admin.get("/me", AuthController.getMe);
  });

});

app.use(api);
app.use(logger)
app.listen(3000);
