import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { z } from 'zod';
import { apiClient } from '../api/client';
import { isApiClientError } from '../api/errors';
import { ErrorBanner } from '../components/ErrorBanner';
import { adminUsernameSchema, utf8ByteLength } from '../utils/credentials';

const setupSchema = z.object({
  setup_token: z.string().trim().min(1, '请输入初始化令牌').max(256, '初始化令牌最多 256 字节'),
  username: adminUsernameSchema,
  password: z.string().refine((value) => {
    const bytes = utf8ByteLength(value);
    return bytes >= 8 && bytes <= 72;
  }, '密码须为 8–72 字节'),
  confirm_password: z.string().min(1, '请再次输入密码'),
}).refine((values) => values.password === values.confirm_password, {
  path: ['confirm_password'],
  message: '两次密码不一致',
});

type SetupValues = z.infer<typeof setupSchema>;

const fields = [
  { name: 'setup_token', label: '初始化令牌', type: 'password', autoComplete: 'off', placeholder: '部署时配置的令牌' },
  { name: 'username', label: '用户名', type: 'text', autoComplete: 'username', placeholder: '设置管理员账号' },
  { name: 'password', label: '密码', type: 'password', autoComplete: 'new-password', placeholder: '8–72 字节' },
  { name: 'confirm_password', label: '确认密码', type: 'password', autoComplete: 'new-password', placeholder: '再次输入密码' },
] as const;

export function AdminSetupPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [submitError, setSubmitError] = useState<unknown>(null);
  const fromPath = (location.state as { from?: string } | null)?.from || '/admin/keyboxes';
  const setup = useQuery({
    queryKey: ['admin-setup'],
    queryFn: ({ signal }) => apiClient.adminSetupStatus({ signal }),
    gcTime: 0,
  });
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<SetupValues>({
    resolver: zodResolver(setupSchema),
    defaultValues: { setup_token: '', username: '', password: '', confirm_password: '' },
  });

  const onSubmit = async (values: SetupValues) => {
    setSubmitError(null);
    try {
      const result = await apiClient.adminSetup({
        setup_token: values.setup_token,
        username: values.username,
        password: values.password,
      });
      reset(); // Secrets stay in form memory only and never enter router/cache state.
      navigate('/admin/login', {
        replace: true,
        state: { from: fromPath, setupComplete: true, username: result.data.admin.username },
      });
    } catch (error) {
      setSubmitError(error);
      if (isApiClientError(error) && (error.code === 40904 || error.code === 40304)) {
        reset();
        void setup.refetch();
      }
    }
  };

  if (setup.isSuccess && !setup.isFetching && setup.data.data.initialized) {
    return <Navigate to="/admin/login" state={{ from: fromPath }} replace />;
  }

  return (
    <div className="mx-auto max-w-md py-8">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-900 text-white">
            <ShieldCheck className="h-5 w-5 text-emerald-400" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900">初始化管理员</h1>
            <p className="mt-1 text-xs text-slate-500">首次部署设置，完成后入口自动关闭。</p>
          </div>
        </div>

        {setup.isPending ? (
          <p className="mt-5 text-sm text-slate-500" role="status">正在检查初始化状态…</p>
        ) : setup.isError ? (
          <div className="mt-5"><ErrorBanner error={setup.error} onRetry={() => void setup.refetch()} /></div>
        ) : !setup.data.data.setup_available ? (
          <div className="mt-5 space-y-3">
            <p className="text-sm text-slate-600" role="status">请先在服务端配置初始化令牌，再刷新此页。</p>
            <button
              type="button"
              onClick={() => void setup.refetch()}
              disabled={setup.isFetching}
              className="btn-interactive rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold disabled:opacity-50"
            >{setup.isFetching ? '检查中…' : '重新检查'}</button>
          </div>
        ) : (
          <>
            {submitError ? <div className="mt-4"><ErrorBanner error={submitError} /></div> : null}
            <form onSubmit={handleSubmit(onSubmit)} className="mt-5" noValidate data-testid="admin-setup-form">
              <fieldset disabled={isSubmitting} className="space-y-4" aria-busy={isSubmitting}>
                {fields.map((field) => (
                  <div key={field.name}>
                    <label htmlFor={`setup-${field.name}`} className="block text-xs font-semibold text-slate-700">
                      {field.label}
                    </label>
                    <input
                      id={`setup-${field.name}`}
                      type={field.type}
                      autoComplete={field.autoComplete}
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      required
                      aria-invalid={Boolean(errors[field.name])}
                      aria-describedby={errors[field.name] ? `setup-${field.name}-error` : undefined}
                      {...register(field.name)}
                      placeholder={field.placeholder}
                      className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs text-slate-900 focus:border-slate-900 focus:outline-none disabled:opacity-60"
                    />
                    {errors[field.name] && (
                      <p id={`setup-${field.name}-error`} className="mt-1 text-xs text-rose-600" role="alert">
                        {errors[field.name]?.message}
                      </p>
                    )}
                  </div>
                ))}
                <button
                  type="submit"
                  className="btn-interactive flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white shadow-xs hover:bg-slate-800 disabled:opacity-50"
                >
                  <KeyRound className="h-4 w-4" aria-hidden="true" />
                  <span>{isSubmitting ? '创建中…' : '创建管理员'}</span>
                </button>
              </fieldset>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
