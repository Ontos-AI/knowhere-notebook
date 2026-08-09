import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  runPromise: vi.fn(),
  findByIdAndUserIdEffect: vi.fn(),
  listMembersEffect: vi.fn(),
  addMemberEffect: vi.fn(),
  removeMemberEffect: vi.fn(),
  findByEmailEffect: vi.fn(),
  findByIdEffect: vi.fn(),
}))

vi.mock("@/infrastructure/auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
}))

vi.mock("@/domains/workspace/database-runtime", () => ({
  databaseRuntime: {
    runPromise: mocks.runPromise,
  },
}))

vi.mock("@/domains/workspace/repository", () => ({
  workspaceRepository: {
    findByIdAndUserIdEffect: mocks.findByIdAndUserIdEffect,
  },
}))

vi.mock("@/infrastructure/auth/workspace-members-repository", () => ({
  workspaceMembersRepository: {
    listMembersEffect: mocks.listMembersEffect,
    addMemberEffect: mocks.addMemberEffect,
    removeMemberEffect: mocks.removeMemberEffect,
  },
}))

vi.mock("@/infrastructure/auth/users-repository", () => ({
  usersRepository: {
    findByEmailEffect: mocks.findByEmailEffect,
    findByIdEffect: mocks.findByIdEffect,
  },
}))

import type { NextRequest } from "next/server"
import { GET as listMembers, POST as addMember } from "./route"
import { DELETE as removeMember } from "./[userId]/route"

const owner = { id: "user_owner", email: "owner@example.com" }
const workspace = {
  id: "ws_1",
  userId: "user_owner",
  namespace: "default",
  activeKnowhereApiKeyId: null,
  createdAt: new Date(),
}

describe("workspace members routes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCurrentUser.mockResolvedValue(owner)
    mocks.findByIdAndUserIdEffect.mockReturnValue(
      Promise.resolve(workspace),
    )
    mocks.runPromise.mockImplementation(
      (effect: { then: (fn: unknown) => unknown }) =>
        effect as unknown as Promise<unknown>,
    )
  })

  it("lists members with user info", async () => {
    mocks.listMembersEffect.mockReturnValue(
      Promise.resolve([
        { id: "m1", workspaceId: "ws_1", userId: "user_2", createdAt: new Date(), deletedAt: null },
      ]),
    )
    mocks.findByIdEffect.mockReturnValue(
      Promise.resolve({
        id: "user_2",
        email: "teammate@example.com",
        name: "Teammate",
      }),
    )
    mocks.runPromise.mockImplementation((effect: unknown) =>
      Promise.resolve(effect),
    )

    const response = await listMembers(new Request("http://localhost/api/workspaces/ws_1/members") as NextRequest, {
      params: Promise.resolve({ workspaceId: "ws_1" }),
    })
    const body = (await response.json()) as {
      members?: { userId: string; email: string | null }[]
    }

    expect(response.status).toBe(200)
    expect(body.members).toEqual([
      { userId: "user_2", email: "teammate@example.com", name: "Teammate" },
    ])
  })

  it("rejects non-members and non-owners", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: "user_other", email: "x@y.com" })
    mocks.findByIdAndUserIdEffect.mockReturnValue(Promise.resolve(null))

    const response = await addMember(
      new Request("http://localhost/api/workspaces/ws_1/members", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "teammate@example.com" }),
      }) as NextRequest,
      { params: Promise.resolve({ workspaceId: "ws_1" }) },
    )
    const body = (await response.json()) as { message?: string }

    expect(response.status).toBe(404)
    expect(body.message).toMatch(/not found/i)
  })

  it("adds a member by email", async () => {
    mocks.findByEmailEffect.mockReturnValue(
      Promise.resolve({ id: "user_2", email: "teammate@example.com" }),
    )
    mocks.addMemberEffect.mockReturnValue(Promise.resolve(undefined))

    const response = await addMember(
      new Request("http://localhost/api/workspaces/ws_1/members", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "Teammate@example.com " }),
      }) as NextRequest,
      { params: Promise.resolve({ workspaceId: "ws_1" }) },
    )
    const body = (await response.json()) as { member?: { userId: string } }

    expect(response.status).toBe(200)
    expect(mocks.findByEmailEffect).toHaveBeenCalledWith("teammate@example.com")
    expect(mocks.addMemberEffect).toHaveBeenCalledWith("ws_1", "user_2")
    expect(body.member).toEqual({ userId: "user_2" })
  })

  it("rejects unknown emails with a friendly message", async () => {
    mocks.findByEmailEffect.mockReturnValue(Promise.resolve(null))

    const response = await addMember(
      new Request("http://localhost/api/workspaces/ws_1/members", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "nobody@example.com" }),
      }) as NextRequest,
      { params: Promise.resolve({ workspaceId: "ws_1" }) },
    )
    const body = (await response.json()) as { message?: string }

    expect(response.status).toBe(404)
    expect(body.message).toMatch(/admin-provisioned/i)
  })

  it("allows only the owner to remove members, not the owner themselves", async () => {
    mocks.removeMemberEffect.mockReturnValue(Promise.resolve(undefined))

    const okResponse = await removeMember(
      new Request("http://localhost/api/workspaces/ws_1/members/user_2", { method: "DELETE" }) as NextRequest,
      {
        params: Promise.resolve({ workspaceId: "ws_1", userId: "user_2" }),
      },
    )
    expect(okResponse.status).toBe(200)
    expect(mocks.removeMemberEffect).toHaveBeenCalledWith("ws_1", "user_2")

    const selfResponse = await removeMember(
      new Request("http://localhost/api/workspaces/ws_1/members/user_owner", { method: "DELETE" }) as NextRequest,
      {
        params: Promise.resolve({ workspaceId: "ws_1", userId: "user_owner" }),
      },
    )
    expect(selfResponse.status).toBe(400)
  })
})
