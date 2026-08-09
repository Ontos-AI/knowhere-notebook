"use server"

import { redirect } from "next/navigation"

import { deleteSession } from "@/infrastructure/auth/session"

export async function logoutAction(): Promise<void> {
  await deleteSession()
  redirect("/login")
}
