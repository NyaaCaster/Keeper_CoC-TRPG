/**
 * 调查员登录表单 —— 可复用组件。
 *
 * 用于首页内嵌展示，也可被 LoginModal 包装为弹窗使用。
 * 配色遵循 Keeper 三色铁律（黑绿白）。
 */

import React, { useState } from "react";
import { LogIn, Loader2 } from "lucide-react";
import type { AccountState } from "../lib/idbAccount";
import { saveAccountState } from "../lib/idbAccount";
import { login as loginApi } from "../lib/accountApi";

interface LoginFormProps {
  onLoginSuccess: (state: AccountState) => void;
  /** 可选：弹窗模式下提供取消回调（显示"取消"按钮） */
  onCancel?: () => void;
}

export default function LoginForm({ onLoginSuccess, onCancel }: LoginFormProps) {
  const [loginAccount, setLoginAccount] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const handleLogin = async () => {
    const account = loginAccount.trim();
    if (!account) {
      setLoginError("请输入邮箱或用户名");
      return;
    }
    if (!loginPassword || loginPassword.length < 6) {
      setLoginError("密码需至少 6 个字符");
      return;
    }

    setLoginLoading(true);
    setLoginError(null);
    const result = await loginApi(account, loginPassword);
    setLoginLoading(false);

    if (result.ok) {
      await saveAccountState(result.data);
      onLoginSuccess(result.data);
    } else {
      setLoginError(
        result.error === "bad_credentials"
          ? "账号或密码错误"
          : result.error === "invalid_account"
            ? "请输入有效的邮箱或用户名"
            : result.error === "invalid_password"
              ? "密码需至少 6 个字符"
              : result.error === "account_service_unavailable"
                ? "账号服务暂时不可用，请稍后重试"
                : "网络连接失败，请检查网络后重试",
      );
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !loginLoading) handleLogin();
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold text-coc-gold tracking-widest font-mono text-center">
        调查员登录
      </h3>

      <input
        type="text"
        value={loginAccount}
        onChange={(e) => {
          setLoginAccount(e.target.value);
          setLoginError(null);
        }}
        onKeyDown={handleKeyDown}
        placeholder="邮箱或用户名"
        autoComplete="username"
        disabled={loginLoading}
        className="w-full bg-[#121f18] border border-emerald-500/30 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-emerald-500 disabled:opacity-50"
      />

      <input
        type="password"
        value={loginPassword}
        onChange={(e) => {
          setLoginPassword(e.target.value);
          setLoginError(null);
        }}
        onKeyDown={handleKeyDown}
        placeholder="密码"
        autoComplete="current-password"
        disabled={loginLoading}
        className="w-full bg-[#121f18] border border-emerald-500/30 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-emerald-500 disabled:opacity-50"
      />

      {loginError && (
        <p className="text-red-400 text-xs text-center">{loginError}</p>
      )}

      <div className="flex gap-2">
        {onCancel && (
          <button
            onClick={onCancel}
            disabled={loginLoading}
            className="flex-1 py-2.5 bg-gray-800/60 hover:bg-gray-700 border border-gray-700 text-gray-300 font-bold text-sm rounded transition-colors disabled:opacity-50"
          >
            取消
          </button>
        )}
        <button
          onClick={handleLogin}
          disabled={loginLoading}
          className="flex-1 py-2.5 bg-emerald-600/80 hover:bg-emerald-500 border border-emerald-500 text-white font-bold text-sm rounded transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {loginLoading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              登录中…
            </>
          ) : (
            <>
              <LogIn className="w-4 h-4" />
              登录
            </>
          )}
        </button>
      </div>

      <p className="text-xs text-gray-500 text-center">
        没有账号？{" "}
        <a
          href="http://h.nyaa.host:5110/?view=register"
          target="_blank"
          rel="noopener noreferrer"
          className="text-coc-gold hover:underline"
        >
          去注册
        </a>
      </p>
    </div>
  );
}
