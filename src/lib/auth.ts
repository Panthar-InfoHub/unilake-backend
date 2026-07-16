import {betterAuth} from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import {prisma} from './prisma.js'
import { config } from '../config/env.js'


export const auth = betterAuth({
  baseURL: config.betterAuthUrl,
  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: {
    google: {
      clientId: config.googleId,
      clientSecret: config.googleSecret,
    },
    facebook: {
      clientId: config.facebookId,
      clientSecret: config.facebookSecret ,
    },
  },
  user : {
    additionalFields: {
      role : {
        type : ['ADMIN', 'USER'],
        required: false,
        defaultValue: 'USER',
        input: false,
      }
    }
  },
  advanced : {
    defaultCookieAttributes: {
      sameSite: "none",
      secure: true,
      httpOnly: true,
    },
  },
  trustedOrigins: [
    'http://localhost:3000', // your frontend dev URL — adjust to your actual frontend port
    'https://unilake-backend-590672762351.asia-south1.run.app',
    'https://unilake-backend.onrender.com'
  ],
})