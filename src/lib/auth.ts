import {betterAuth} from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import {prisma} from './prisma.js'


export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
    },
    facebook: {
      clientId: process.env.FACEBOOK_CLIENT_ID as string,
      clientSecret: process.env.FACEBOOK_CLIENT_SECRET as string,
    },
  },
  trustedOrigins: [
    'http://localhost:3000', // your frontend dev URL — adjust to your actual frontend port
  ],
})