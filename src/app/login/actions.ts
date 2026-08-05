"use server"

import { redirect } from "next/navigation"
import { Effect } from "effect"

import { databaseRuntime } from "@/domains/workspace/database-runtime"
import { usersRepository } from "@/infrastructure/auth/users-repository"
import { accountLinksRepository } from "@/infrastructure/auth/account-links-repository"
import { createSession } from "@/infrastructure/auth/session"
import { verifyPassword } from "@/lib/password"

export type LoginActionState = {
  readonly error: string | null
}

export async function loginAction(
  _previousState: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase()
  const password = String(formData.get("password") ?? "")

  if (!email || !password) {
    return { error: "Enter your email and password." }
  }

  const user = await databaseRuntime
    .runPromise(
      Effect.gen(function* () {
        const user = yield* usersRepository.findByEmailEffect(email)
        if (!user) return null

        const link = yield* accountLinksRepository.findByUserIdAndProviderEffect(
          user.id,
          "password",
        )
        if (!link?.passwordHash) return null

        return user
      }),
    )
    .catch(() => null)

  if (!user) {
    return { error: "Incorrect email or password." }
  }

  const link = await databaseRuntime
    .runPromise(
      accountLinksRepository.findByUserIdAndProviderEffect(user.id, "password"),
    )
    .catch(() => null)

  if (!link?.passwordHash) {
    return { error: "Incorrect email or password." }
  }

  const ok = await verifyPassword(password, link.passwordHash)
  if (!ok) {
    return { error: "Incorrect email or password." }
  }

  await createSession(user.id)
  redirect("/")
}
