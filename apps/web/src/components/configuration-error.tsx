import { clientEnv } from '@/config/env'

export function ConfigurationError() {
  return (
    <main className='grid min-h-svh place-items-center bg-slate-50 p-6'>
      <section className='w-full max-w-xl rounded-2xl border border-red-200 bg-white p-6 shadow-sm'>
        <p className='text-sm font-bold tracking-wide text-red-600 uppercase'>
          Konfiqurasiya xətası
        </p>
        <h1 className='mt-2 text-2xl font-black text-slate-950'>
          Tətbiq başladılmadı
        </h1>
        <p className='mt-3 text-sm leading-6 text-slate-600'>
          Aşağıdakı public mühit dəyişənlərini düzgün təyin edib tətbiqi yenidən
          başladın. Service-role və başqa məxfi açarları VITE_ prefiksi ilə
          paylaşmayın.
        </p>
        <ul className='mt-4 list-inside list-disc text-sm font-semibold text-red-700'>
          {clientEnv.issues.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      </section>
    </main>
  )
}
