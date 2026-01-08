// test/controller/AuthController.ts
import type { Context } from '../../src/context'; // ปรับ Path ตามโครงสร้างจริง
import { createToken } from '../../src/auth';    // ปรับ Path ตามโครงสร้างจริง

interface LoginBody {
  username?: string;
  password?: string;
}

export class AuthController {
  /**
   * LOGIN: (POST /api/v1/auth/login)
   * ทำการตรวจสอบ User และสร้าง "Bare Token" กลับไป
   */
  static async login(ctx: Context) {
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
      // ในการใช้งานจริง: ควรใช้ Password.verify(body.password, user.hash_from_db)
      if (body.username === "admin" && body.password === "1234") {
        const secret = process.env.JWT_SECRET || "default_secret";

        /**
         * 🚀 POINT OF SPEED:
         * เราฝังทุกอย่างที่ 'Controller อื่นๆ' ต้องใช้ลงใน Token ทันที
         * เพื่อลดการ Query Database ใน Request ถัดไป
         */
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

  /**
   * GET ME: (GET /api/v1/admin/me)
   * ดึงข้อมูลจาก Token ผ่าน Context Getter (379ns Performance)
   */
  static async getMe(ctx: Context) {
    // ดึงผ่าน Getter ที่เราเขียนไว้ใน context.ts
    const user = ctx.get('user');

    if (!user) {
      return ctx.status(401).json({
        status: 'error',
        message: "User session not found"
      });
    }

    // ข้อมูลเหล่านี้ดึงจาก Memory ใน Token (Zero DB Query)
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

  /**
   * GET PROFILE: ตัวอย่างการแสดงผลแบบดิบ
   */
  static getProfile(ctx: Context) {
    return ctx.json({
      status: 'success',
      user: ctx.get('user') // ส่ง Object user ออกไปทั้งหมด
    });
  }
}