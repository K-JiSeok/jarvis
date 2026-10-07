"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";

import { signIn, type LoginState } from "./actions";

const INITIAL: LoginState = { error: null, email: "" };

const inputClass =
  "border-input bg-background focus-visible:ring-ring/50 focus-visible:border-ring h-10 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-[3px]";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signIn, INITIAL);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />

      <div className="space-y-1.5">
        <label htmlFor="email" className="text-sm font-medium">
          이메일
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.email}
          className={inputClass}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="password" className="text-sm font-medium">
          비밀번호
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={inputClass}
        />
      </div>

      {state.error && (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "로그인 중…" : "로그인"}
      </Button>
    </form>
  );
}
