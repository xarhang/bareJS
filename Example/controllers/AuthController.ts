// controllers/AuthController.ts
import type { Context } from '../../src/context';
import { createToken } from '../../src/auth';

interface LoginBody {
  username?: string;
  password?: string;
}

export class AuthController {
  static async login(ctx: any) {
    try {
      const body = await ctx.req.json() as LoginBody;

      // 1. Validation
      if (!body.username || !body.password) {
        return ctx.status(400).json({
          status: 'error',
          message: "Missing credentials"
        });
      }

      // 2. Auth Logic (Mock Admin)
      if (body.username === "admin" && body.password === "1234") {
        const secret = process.env.JWT_SECRET || "default_secret";

        const token = await createToken({
          id: 99,
          username: body.username,
          role: "admin",
          tier: ""
        }, secret);

        console.log(`[Auth] ✅ ${body.username} logged in at ${new Date().toISOString()}`);

        return ctx.json({
          status: 'success',
          token
        });
      }

      return ctx.status(401).json({
        status: 'error',
        message: "Invalid username or password"
      });

    } catch (e) {
      console.error("[Auth Error]:", e);
      return ctx.status(400).json({
        status: 'error',
        message: "Invalid JSON format"
      });
    }
  }

  static async getMe(ctx: any) {
    const user = ctx.get('user');

    if (!user) {
      return ctx.status(401).json({
        status: 'error',
        message: "User session not found"
      });
    }

    return ctx.json({
      status: 'success',
      data: {
        id: user.id,
        username: user.username,
        role: user.role,
        tier: user.tier
      }
    });
  }

  static getProfile(ctx: any) {
    return ctx.json({
      status: 'success',
      user: ctx.get('user')
    });
  }
}