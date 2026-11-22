import type { Child } from 'hono/jsx'
import { subjects, type Subject } from '../corpus/catalog'

type Page = 'study' | 'catalog' | 'progress'

export function Layout({ title, active, subject = 'A-1', children }: { title: string; active?: Page; subject?: Subject; children: Child }) {
  const links = [
    { href: '/', label: '演習', page: 'study' },
    { href: `/catalog?subject=${subjects[subject].slug}`, label: '年度・期', page: 'catalog' },
    { href: `/progress?subject=${subjects[subject].slug}`, label: '学習記録', page: 'progress' },
  ]
  return (
    <html lang="ja">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#f2f5f9" />
        <title>{title} | 支援士 過去問演習</title>
        <link rel="stylesheet" href="/styles.css" />
      </head>
      <body>
        <a class="skip" href="#main">メインコンテンツへ</a>
        <header class="topbar">
          <div class="topbar-inner">
            <a class="brand" href="/"><span class="brand-icon" aria-hidden="true">SC</span><span>支援士 過去問演習</span></a>
            <nav class="topnav" aria-label="メインメニュー">
              {links.map(({ href, label, page }) => (
                <a key={page} href={href} aria-current={page === active ? 'page' : undefined}>{label}</a>
              ))}
            </nav>
          </div>
        </header>
        <main id="main" class="shell">{children}</main>
      </body>
    </html>
  )
}

export function ErrorPage({ title, message }: { title: string; message: string }) {
  return <Layout title={title}>
    <section class="panel empty">
      <h1>{title}</h1>
      <p>{message}</p>
      <a class="button" href="/">演習に戻る</a>
    </section>
  </Layout>
}
