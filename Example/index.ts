import { BareJS, BareRouter, logger} from 'barejs';
import { AuthController } from './controllers/AuthController';
import { bareAuth } from '../src/auth';
import type { Context } from '../src/context';
import { secrets } from 'bun';
const app = new BareJS();
const api = new BareRouter("/api");
 const secret = process.env.JWT_SECRET || "default_secret";
api.group("/v1", (v1:BareRouter) => {

    // 🚪 Public Routes
  v1.group("/auth", (auth:BareRouter) => {
    auth.post("/login", AuthController.login);
  });

    // 🔒 Protected Routes
  v1.group("/admin", bareAuth(secret), (admin:BareRouter) => {
    admin.get("/dashboard", (ctx:Context) => {
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