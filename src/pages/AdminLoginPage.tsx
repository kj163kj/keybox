import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useLocation, useNavigate } from 'react-router-dom';
import { KeyRound, Lock, ShieldCheck, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { isMockMode } from '../api/client';
import { getPreviewCredentials } from '../api/preview-config';
import { ErrorBanner } from '../components/ErrorBanner';
import { useAuth } from '../context/AuthContext';

const loginSchema = z.object({
  username: z
    .string()
    .trim()
    .min(1, '请输入管理员用户名')
    .max(128, '用户名最多 128 个字符'),
  password: z
    .string()
    .min(1, '请输入管理员密码')
    .max(72, '密码最多 72 字节'),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export function AdminLoginPage() {
  const previewCredentials = getPreviewCredentials();
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [submitError, setSubmitError] = useState<unknown>(null);

  const fromPath =
    (location.state as { from?: string } | null)?.from || '/admin/keyboxes';

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      username: '',
      password: '',
    },
  });

  const onSubmit = async (values: LoginFormValues) => {
    setSubmitError(null);
    try {
      const res = await login(values);
      toast.success(`已登录：${res.admin.username}`);
      navigate(fromPath, { replace: true });
    } catch (err) {
      setSubmitError(err);
    }
  };

  return (
    <div className="mx-auto max-w-md py-8">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-900 text-white">
            <Lock className="h-5 w-5 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900">管理员登录</h1>
            <p className="text-xs text-slate-500">
              登录后管理 Keybox 与下载权限
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          <div className="flex items-center gap-1.5 font-semibold text-slate-800">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
            <span>登录提示</span>
          </div>
          <p className="mt-1 leading-relaxed">
            会话有效期为 8 小时，使用完毕请退出登录。
          </p>
        </div>

        {submitError ? (
          <div className="mt-4">
            <ErrorBanner error={submitError} />
          </div>
        ) : null}

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="mt-5 space-y-4"
          noValidate
          data-testid="admin-login-form"
        >
          <div>
            <label
              htmlFor="admin-username"
              className="block text-xs font-semibold text-slate-700"
            >
              用户名
            </label>
            <input
              id="admin-username"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              data-testid="login-username-input"
              {...register('username')}
              placeholder="输入管理员账号"
              className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
            />
            {errors.username && (
              <p className="mt-1 text-xs text-rose-600" role="alert">
                {errors.username.message}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="admin-password"
              className="block text-xs font-semibold text-slate-700"
            >
              密码
            </label>
            <input
              id="admin-password"
              type="password"
              autoComplete="current-password"
              data-testid="login-password-input"
              {...register('password')}
              placeholder="输入密码"
              className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
            />
            {errors.password && (
              <p className="mt-1 text-xs text-rose-600" role="alert">
                {errors.password.message}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            data-testid="login-submit-btn"
            className="btn-interactive flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white shadow-xs hover:bg-slate-800 disabled:opacity-50"
          >
            <KeyRound className="h-4 w-4" />
            <span>{isSubmitting ? '登录中…' : '登录'}</span>
          </button>
        </form>

        {__KEYBOX_PREVIEW__ && isMockMode() && previewCredentials && (
          <div className="mt-5 border-t border-slate-100 pt-4 text-xs">
            <div className="flex items-center gap-1.5 font-semibold text-slate-700">
              <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
              <span>本地预览账号</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setValue('username', previewCredentials.username);
                  setValue('password', previewCredentials.password);
                }}
                data-testid="preview-login-fill-btn"
                className="btn-interactive rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-medium text-emerald-900 hover:bg-emerald-100"
              >
                填入预览账号
              </button>
              <button
                type="button"
                onClick={() => {
                  setValue('username', previewCredentials.username);
                  setValue('password', 'wrong');
                }}
                className="btn-interactive rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 font-medium text-rose-900 hover:bg-rose-100"
              >
                密码错误
              </button>
              <button
                type="button"
                onClick={() => {
                  setValue('username', 'ratelimit');
                  setValue('password', 'ratelimit');
                }}
                className="btn-interactive rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 font-medium text-amber-900 hover:bg-amber-100"
              >
                登录限流
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
