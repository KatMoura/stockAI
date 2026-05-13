import './style.css';
import type { AccessLog, AppUser, Product, Repository, UserRole } from './models';
import { LocalRepository } from './data/localRepository';
import { supabase, isSupabaseConfigured } from './data/supabaseClient';
import { SupabaseRepository } from './data/supabaseRepository';

type Screen = 'inicio' | 'produtos' | 'relatorios' | 'alertas' | 'historico' | 'usuarios' | 'metricas';
type AuthMode = 'login' | 'register';

const foodCategories = [
  { value: 'Hortifrutis', unit: 'kg' },
  { value: 'Padaria', unit: 'un' },
  { value: 'Bebidas', unit: 'un' },
  { value: 'Mercearia', unit: 'un' },
  { value: 'Carnes e Frios', unit: 'kg' },
  { value: 'Laticinios', unit: 'un' },
  { value: 'Higiene e Limpeza', unit: 'un' },
  { value: 'Congelados', unit: 'un' },
  { value: 'Descartaveis', unit: 'un' },
  { value: 'Rotisseria', unit: 'kg' },
];

function defaultUnitForCategory(category: string): string {
  return foodCategories.find((item) => item.value === category)?.unit ?? 'un';
}

const appElement = document.querySelector<HTMLDivElement>('#app');

if (!appElement) {
  throw new Error('Elemento #app nao encontrado.');
}

const app = appElement;

const requestedProvider = import.meta.env.VITE_DATA_PROVIDER === 'supabase' ? 'supabase' : 'local';
const repository: Repository =
  requestedProvider === 'supabase' && supabase && isSupabaseConfigured
    ? new SupabaseRepository(supabase)
    : new LocalRepository();

let users: AppUser[] = [];
let products: Product[] = [];
let accessLogs: AccessLog[] = [];
let currentUser: AppUser | null = null;
let activeScreen: Screen = 'inicio';
let authMode: AuthMode = 'login';
let authMessage = '';
let editProductId: string | null = null;
let editingUserId: string | null = null;
let searchQuery = '';
let productFilter: 'all' | 'critical' | 'low' | 'out' = 'all';

function id(): string {
  return crypto.randomUUID();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function money(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function dateTime(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function getDashboardMetrics() {
  const totalProdutos = products.length;
  const estoqueTotal = products.reduce((sum, product) => sum + product.quantity, 0);
  const valorTotal = products.reduce((sum, product) => sum + product.price * product.quantity, 0);
  const itensCriticos = products.filter((product) => product.quantity <= product.minQuantity).length;

  return { totalProdutos, estoqueTotal, valorTotal, itensCriticos };
}

function getAccessMetrics() {
  const now = Date.now();
  const sevenDays = now - 7 * 24 * 60 * 60 * 1000;
  const thirtyDays = now - 30 * 24 * 60 * 60 * 1000;

  const recentLogins = accessLogs.filter(
    (log) => log.action === 'login' && new Date(log.timestamp).getTime() >= sevenDays,
  ).length;

  const activeUsers = new Set(
    accessLogs
      .filter((log) => new Date(log.timestamp).getTime() >= thirtyDays)
      .map((log) => log.userId),
  ).size;

  const pageViews = accessLogs.filter((log) => log.action === 'page_view');
  const pageCounter = pageViews.reduce<Record<string, number>>((acc, log) => {
    const key = log.details ?? 'inicio';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const topPages = Object.entries(pageCounter)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  return {
    recentLogins,
    activeUsers,
    totalPageViews: pageViews.length,
    topPages,
  };
}

function getReportMetrics() {
  const byCategory = products.reduce<Record<string, number>>((acc, product) => {
    const key = product.category ?? 'Sem categoria';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const byCategoryValue = products.reduce<Record<string, number>>((acc, product) => {
    const key = product.category ?? 'Sem categoria';
    acc[key] = (acc[key] ?? 0) + product.quantity;
    return acc;
  }, {});

  const byUnit = products.reduce<Record<string, number>>((acc, product) => {
    const key = product.unit ?? 'un';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const orderedCategories = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
  const criticalProducts = products
    .filter((product) => product.quantity <= product.minQuantity)
    .sort((a, b) => a.quantity - b.quantity)
    .slice(0, 6);

  const totalItems = products.reduce((sum, product) => sum + product.quantity, 0);
  const stockValue = products.reduce((sum, product) => sum + product.quantity * product.price, 0);
  const averageTicket = products.length > 0 ? stockValue / products.length : 0;

  return {
    orderedCategories,
    byCategoryValue: Object.entries(byCategoryValue).sort((a, b) => b[1] - a[1]),
    byUnit: Object.entries(byUnit).sort((a, b) => b[1] - a[1]),
    criticalProducts,
    totalItems,
    stockValue,
    averageTicket,
  };
}

async function logAction(action: AccessLog['action'], details?: string): Promise<void> {
  if (!currentUser) {
    return;
  }

  accessLogs.unshift({
    id: id(),
    userId: currentUser.id,
    userName: currentUser.name,
    action,
    details,
    timestamp: new Date().toISOString(),
  });

  accessLogs = accessLogs.slice(0, 1000);
  await repository.saveAccessLogs(accessLogs);
}

async function seedInitialData(): Promise<void> {
  users = await repository.getUsers();
  products = await repository.getProducts();
  accessLogs = await repository.getAccessLogs();

  if (users.length === 0) {
    const admin: AppUser = {
      id: id(),
      name: 'Administrador StockIa',
      email: 'admin@stockia.com',
      password: 'Admin@123',
      role: 'admin',
      createdAt: new Date().toISOString(),
    };
    users = [admin];
    await repository.saveUsers(users);
  }

  if (products.length === 0) {
    const now = new Date().toISOString();
    const creatorId = users[0].id;
    products = [
      {
        id: id(),
        name: 'Tomate Italiano',
        quantity: 11,
        minQuantity: 5,
        price: 8.9,
        category: 'Hortifrutis',
        unit: 'kg',
        createdBy: creatorId,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: id(),
        name: 'Pao Francsinho',
        quantity: 45,
        minQuantity: 20,
        price: 0.99,
        category: 'Padaria',
        unit: 'un',
        createdBy: creatorId,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: id(),
        name: 'Leite Integral 1L',
        quantity: 18,
        minQuantity: 12,
        price: 5.49,
        category: 'Laticinios',
        unit: 'un',
        createdBy: creatorId,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: id(),
        name: 'Refrigerante Cola 2L',
        quantity: 7,
        minQuantity: 8,
        price: 9.99,
        category: 'Bebidas',
        unit: 'un',
        createdBy: creatorId,
        createdAt: now,
        updatedAt: now,
      },
    ];
    await repository.saveProducts(products);
  }
}

function renderAuth(): void {
  const isLogin = authMode === 'login';
  app.innerHTML = `
    <main class="auth-page">
      <section class="auth-card reveal">
        <p class="logo-tag">StockIa</p>
        <h1>Gestao de estoque para supermercado</h1>
        <p class="subtitle">Controle de reposicao, categorias de alimentos e relatórios em tempo real para a loja.</p>

        <div class="auth-tabs">
          <button data-action="set-auth-mode" data-mode="login" class="${isLogin ? 'active' : ''}">Entrar</button>
          <button data-action="set-auth-mode" data-mode="register" class="${!isLogin ? 'active' : ''}">Cadastrar</button>
        </div>

        <form id="auth-form" class="form-grid">
          ${
            isLogin
              ? `
            <label>
              Email
              <input name="email" type="email" required placeholder="admin@stockia.com" />
            </label>
            <label>
              Senha
              <input name="password" type="password" required minlength="6" placeholder="********" />
            </label>
          `
              : `
            <label>
              Nome completo
              <input name="name" type="text" required minlength="3" placeholder="Seu nome" />
            </label>
            <label>
              Email
              <input name="email" type="email" required placeholder="voce@empresa.com" />
            </label>
            <label>
              Senha
              <input name="password" type="password" required minlength="6" placeholder="Minimo 6 caracteres" />
            </label>
            <label>
              Confirmar senha
              <input name="confirmPassword" type="password" required minlength="6" placeholder="Repita a senha" />
            </label>
          `
          }
          <button type="submit" class="primary">${isLogin ? 'Entrar no StockIa' : 'Criar conta'}</button>
        </form>

        <p class="helper">Credencial inicial: admin@stockia.com / Admin@123</p>
        ${authMessage ? `<p class="message">${escapeHtml(authMessage)}</p>` : ''}
      </section>
    </main>
  `;
}

function screenTitle(screen: Screen): string {
  const titles: Record<Screen, string> = {
    inicio: 'Visao geral',
    produtos: 'Cadastro de produtos',
    relatorios: 'Relatorios executivos',
    alertas: 'Alertas de estoque minimo',
    historico: 'Historico de acessos e acoes',
    usuarios: 'Permissoes e usuarios',
    metricas: 'Metricas administrativas de acesso',
  };
  return titles[screen];
}

function renderHome(): string {
  if (!currentUser) {
    return '';
  }

  const metrics = getDashboardMetrics();
  const reportMetrics = getReportMetrics();
  const access = getAccessMetrics();
  const recentProducts = [...products]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 5);

  const needsRestock = products
    .filter((product) => product.quantity <= product.minQuantity)
    .sort((a, b) => a.quantity - b.quantity)
    .slice(0, 6);

  if (currentUser.role === 'staff') {
    return `
      <section class="hero-card panel">
        <div>
          <p class="eyebrow">Painel do operador</p>
          <h2>Rotina do turno: reposicao, conferencia e atualizacao de itens.</h2>
          <p class="hero-copy">Visual simplificado para agilizar o trabalho no piso da loja e no estoque.</p>
        </div>
        <div class="hero-side">
          <div class="hero-side-item">
            <span>Itens para reposicao</span>
            <strong>${needsRestock.length}</strong>
          </div>
          <div class="hero-side-item">
            <span>Produtos ativos</span>
            <strong>${metrics.totalProdutos}</strong>
          </div>
          <div class="hero-side-item">
            <span>Itens em estoque</span>
            <strong>${metrics.estoqueTotal}</strong>
          </div>
        </div>
      </section>

      <section class="cards">
        <article class="card warning">
          <p>Alertas de reposicao</p>
          <h3>${metrics.itensCriticos}</h3>
        </article>
        <article class="card">
          <p>Categorias monitoradas</p>
          <h3>${new Set(products.map((product) => product.category ?? 'Sem categoria')).size}</h3>
        </article>
        <article class="card">
          <p>Atualizacoes hoje</p>
          <h3>${access.totalPageViews}</h3>
        </article>
      </section>

      <section class="panel">
        <h3>Lista de reposicao do turno</h3>
        <div class="stack">
          ${
            needsRestock.length > 0
              ? needsRestock
                  .map(
                    (product) => `
                <article class="report-card">
                  <strong>${escapeHtml(product.name)}</strong>
                  <span>${escapeHtml(product.category ?? 'Sem categoria')} · estoque ${product.quantity} / minimo ${product.minQuantity}</span>
                </article>
              `,
                  )
                  .join('')
              : '<p class="empty">Sem reposicoes pendentes no momento.</p>'
          }
        </div>
      </section>
    `;
  }

  return `
    <section class="hero-card panel">
      <div>
        <p class="eyebrow">Painel administrativo</p>
        <h2>Visao executiva do supermercado por estoque, categoria e performance.</h2>
        <p class="hero-copy">Acompanhe valor de inventario, criticidade de abastecimento e indicadores gerais da operacao.</p>
      </div>
      <div class="hero-side">
        <div class="hero-side-item">
          <span>Valor em estoque</span>
          <strong>${money(metrics.valorTotal)}</strong>
        </div>
        <div class="hero-side-item">
          <span>Top categoria</span>
          <strong>${escapeHtml(reportMetrics.orderedCategories[0]?.[0] ?? 'Sem dados')}</strong>
        </div>
        <div class="hero-side-item">
          <span>Itens criticos</span>
          <strong>${metrics.itensCriticos}</strong>
        </div>
      </div>
    </section>

    <section class="cards">
      <article class="card">
        <p>Produtos cadastrados</p>
        <h3>${metrics.totalProdutos}</h3>
      </article>
      <article class="card">
        <p>Unidades em estoque</p>
        <h3>${metrics.estoqueTotal}</h3>
      </article>
      <article class="card">
        <p>Valor do inventario</p>
        <h3>${money(metrics.valorTotal)}</h3>
      </article>
      <article class="card warning">
        <p>Itens em estado critico</p>
        <h3>${metrics.itensCriticos}</h3>
      </article>
    </section>

    <section class="panel">
      <h3>Atualizacoes recentes</h3>
      <table>
        <thead>
          <tr>
            <th>Produto</th>
            <th>Estoque</th>
            <th>Atualizado em</th>
          </tr>
        </thead>
        <tbody>
          ${
            recentProducts.length > 0
              ? recentProducts
                  .map(
                    (product) => `
                <tr>
                  <td>${escapeHtml(product.name)}</td>
                  <td>${product.quantity}</td>
                  <td>${dateTime(product.updatedAt)}</td>
                </tr>
              `,
                  )
                  .join('')
              : '<tr><td colspan="4">Nenhum produto cadastrado.</td></tr>'
          }
        </tbody>
      </table>
    </section>

    <section class="panel">
      <h3>Resumo por categoria</h3>
      <div class="summary-grid">
        ${reportMetrics.orderedCategories
          .slice(0, 6)
          .map(
            ([category, count]) => `
              <div class="summary-chip">
                <strong>${escapeHtml(category)}</strong>
                <span>${count} produtos</span>
              </div>
            `,
          )
          .join('')}
      </div>
    </section>
  `;
}

function renderProducts(): string {
  const editingProduct = editProductId ? products.find((product) => product.id === editProductId) : null;
  // filtragem por busca e status
  const q = searchQuery.trim().toLowerCase();
  const filtered = products.filter((p) => {
    const matchesQuery =
      !q ||
      p.name.toLowerCase().includes(q) ||
      (p.category ?? '').toLowerCase().includes(q) ||
      (p.barcode ?? '').toLowerCase().includes(q);

    let matchesFilter = true;
    if (productFilter === 'critical') matchesFilter = p.quantity <= p.minQuantity;
    if (productFilter === 'low') matchesFilter = p.quantity <= p.minQuantity * 2 && p.quantity > p.minQuantity;
    if (productFilter === 'out') matchesFilter = p.quantity === 0;

    return matchesQuery && matchesFilter;
  });

  return `
    <section class="panel catalog-toolbar">
      <div>
        <p class="eyebrow">Catálogo de supermercado</p>
        <h3>Cadastro de produtos por setor alimentar</h3>
      </div>
      <div class="catalog-metrics">
        <div><span>Itens filtrados</span><strong>${filtered.length}</strong></div>
        <div><span>Alertas</span><strong>${products.filter((product) => product.quantity <= product.minQuantity).length}</strong></div>
        <div><span>Categorias</span><strong>${new Set(products.map((product) => product.category ?? 'Sem categoria')).size}</strong></div>
      </div>
    </section>

    <section class="panel split">
      <div>
        <h3>${editingProduct ? 'Editar produto' : 'Novo produto'}</h3>
        <form id="product-form" class="form-grid">
          <input type="hidden" name="productId" value="${editingProduct ? editingProduct.id : ''}" />
          <label>
            Nome do produto
            <input name="name" required minlength="3" value="${editingProduct ? escapeHtml(editingProduct.name) : ''}" />
          </label>
          <label>
            Categoria
            <select name="category">
              <option value="">Selecione a categoria</option>
              ${foodCategories
                .map(
                  (category) => `
                    <option value="${category.value}" ${editingProduct?.category === category.value ? 'selected' : ''}>${category.value}</option>
                  `,
                )
                .join('')}
            </select>
          </label>
          <label>
            Unidade
            <select name="unit">
              <option value="un" ${editingProduct?.unit === 'un' ? 'selected' : ''}>un</option>
              <option value="kg" ${editingProduct?.unit === 'kg' ? 'selected' : ''}>kg</option>
              <option value="l" ${editingProduct?.unit === 'l' ? 'selected' : ''}>l</option>
              <option value="cx" ${editingProduct?.unit === 'cx' ? 'selected' : ''}>cx</option>
              <option value="dz" ${editingProduct?.unit === 'dz' ? 'selected' : ''}>dz</option>
            </select>
          </label>
          <label>
            Codigo de barras
            <input name="barcode" value="${editingProduct ? escapeHtml(editingProduct.barcode ?? '') : ''}" />
          </label>
          <label>
            Imagem (URL)
            <input name="imageUrl" value="${editingProduct ? escapeHtml(editingProduct.imageUrl ?? '') : ''}" placeholder="https://..." />
          </label>
          <label>
            Quantidade
            <input name="quantity" type="number" min="0" required value="${editingProduct ? editingProduct.quantity : 0}" />
          </label>
          <label>
            Estoque minimo
            <input name="minQuantity" type="number" min="0" required value="${editingProduct ? editingProduct.minQuantity : 0}" />
          </label>
          <label>
            Valor unitario
            <input name="price" type="number" min="0" step="0.01" required value="${editingProduct ? editingProduct.price : 0}" />
          </label>
          <div style="display:flex;gap:8px;align-items:center;">
            <button type="submit" class="primary">${editingProduct ? 'Salvar' : 'Cadastrar'}</button>
            ${editingProduct ? '<button type="button" data-action="cancel-product-edit">Cancelar</button>' : ''}
          </div>
        </form>
      </div>

      <div>
        <div style="display:flex;gap:8px;align-items:center;justify-content:space-between;">
          <div class="search-bar">
            <input data-action="search" placeholder="Buscar produto, categoria ou codigo" value="${escapeHtml(searchQuery)}" />
            <select data-action="filter">
              <option value="all" ${productFilter === 'all' ? 'selected' : ''}>Todos</option>
              <option value="critical" ${productFilter === 'critical' ? 'selected' : ''}>Criticos (<= min)</option>
              <option value="low" ${productFilter === 'low' ? 'selected' : ''}>Baixo estoque</option>
              <option value="out" ${productFilter === 'out' ? 'selected' : ''}>Zerados</option>
            </select>
          </div>
          <div><small>${filtered.length} resultado(s)</small></div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Produto</th>
              <th>Categoria</th>
              <th>Qtd</th>
              <th>Un</th>
              <th>Valor</th>
              <th>Acoes</th>
            </tr>
          </thead>
          <tbody>
            ${
              filtered.length > 0
                ? filtered
                    .map(
                      (product) => `
                  <tr>
                    <td style="display:flex;gap:8px;align-items:center;">
                      ${product.imageUrl ? `<img src="${escapeHtml(product.imageUrl)}" alt="" style="width:48px;height:48px;object-fit:cover;border-radius:6px;"/>` : `<div style=\"width:48px;height:48px;border-radius:6px;background:#f1f7ff;display:flex;align-items:center;justify-content:center;color:var(--navy-700);\">${escapeHtml((product.name[0]||'').toUpperCase())}</div>`}
                      <div>
                        <strong>${escapeHtml(product.name)}</strong>
                        <div style="color:var(--ink-500);font-size:0.85rem;">${product.barcode ?? '-'}</div>
                      </div>
                    </td>
                    <td>${escapeHtml(product.category ?? '-')}</td>
                    <td>${product.quantity} ${product.quantity <= product.minQuantity ? '<span class="badge low">!</span>' : ''}</td>
                    <td>${escapeHtml(product.unit ?? '-')}</td>
                    <td>${money(product.price)}</td>
                    <td class="actions">
                      <button data-action="edit-product" data-id="${product.id}">Editar</button>
                      <button data-action="delete-product" data-id="${product.id}" class="danger">Excluir</button>
                    </td>
                  </tr>
                `,
                    )
                    .join('')
                : '<tr><td colspan="7">Nenhum produto encontrado.</td></tr>'
            }
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderAlerts(): string {
  const criticalProducts = products.filter((product) => product.quantity <= product.minQuantity);

  return `
    <section class="panel">
      <h3>Alertas ativos</h3>
      <div class="stack">
        ${
          criticalProducts.length > 0
            ? criticalProducts
                .map(
                  (product) => `
              <article class="alert-card">
                <strong>${escapeHtml(product.name)}</strong>
                <p>Quantidade atual: ${product.quantity} | Minimo esperado: ${product.minQuantity}</p>
              </article>
            `,
                )
                .join('')
            : '<p class="empty">Nenhum alerta no momento.</p>'
        }
      </div>
    </section>
  `;
}

function renderReports(): string {
  if (!currentUser || currentUser.role !== 'admin') {
    return '<section class="panel"><p>Acesso restrito ao administrador.</p></section>';
  }

  const metrics = getReportMetrics();

  return `
    <section class="cards">
      <article class="card">
        <p>Itens em estoque</p>
        <h3>${metrics.totalItems}</h3>
      </article>
      <article class="card">
        <p>Valor estimado</p>
        <h3>${money(metrics.stockValue)}</h3>
      </article>
      <article class="card">
        <p>Ticket medio por item</p>
        <h3>${money(metrics.averageTicket)}</h3>
      </article>
      <article class="card warning">
        <p>Produtos criticos</p>
        <h3>${metrics.criticalProducts.length}</h3>
      </article>
    </section>

    <section class="panel split">
      <div>
        <h3>Categoria x quantidade</h3>
        <div class="bar-list">
          ${metrics.orderedCategories
            .map(
              ([category, count]) => `
                <div class="bar-row">
                  <span>${escapeHtml(category)}</span>
                  <div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, count * 12)}%"></div></div>
                  <strong>${count}</strong>
                </div>
              `,
            )
            .join('')}
        </div>
      </div>
      <div>
        <h3>Produtos por unidade</h3>
        <div class="summary-grid compact">
          ${metrics.byUnit
            .map(
              ([unit, count]) => `
                <div class="summary-chip">
                  <strong>${escapeHtml(unit)}</strong>
                  <span>${count} itens</span>
                </div>
              `,
            )
            .join('')}
        </div>
        <h3 style="margin-top:1rem;">Produtos com reposição urgente</h3>
        <div class="stack">
          ${metrics.criticalProducts.length > 0
            ? metrics.criticalProducts
                .map(
                  (product) => `
                    <article class="report-card">
                      <strong>${escapeHtml(product.name)}</strong>
                      <span>${escapeHtml(product.category ?? 'Sem categoria')} · ${product.quantity} ${escapeHtml(product.unit ?? 'un')}</span>
                    </article>
                  `,
                )
                .join('')
            : '<p class="empty">Nenhum produto precisa de reposição.</p>'}
        </div>
      </div>
    </section>
  `;
}

function renderHistory(): string {
  const history = accessLogs.slice(0, 120);

  return `
    <section class="panel">
      <h3>Historico de eventos</h3>
      <table>
        <thead>
          <tr>
            <th>Data</th>
            <th>Usuario</th>
            <th>Acao</th>
            <th>Detalhes</th>
          </tr>
        </thead>
        <tbody>
          ${
            history.length > 0
              ? history
                  .map(
                    (log) => `
                <tr>
                  <td>${dateTime(log.timestamp)}</td>
                  <td>${escapeHtml(log.userName)}</td>
                  <td>${escapeHtml(log.action)}</td>
                  <td>${escapeHtml(log.details ?? '-')}</td>
                </tr>
              `,
                  )
                  .join('')
              : '<tr><td colspan="4">Sem historico.</td></tr>'
          }
        </tbody>
      </table>
    </section>
  `;
}

function renderUsers(): string {
  if (!currentUser || currentUser.role !== 'admin') {
    return '<section class="panel"><p>Acesso restrito ao administrador.</p></section>';
  }

  const editingUser = editingUserId ? users.find((user) => user.id === editingUserId) : null;

  return `
    <section class="panel split">
      <div>
        <h3>${editingUser ? 'Editar permissao' : 'Criar usuario interno'}</h3>
        <form id="user-form" class="form-grid">
          <input type="hidden" name="userId" value="${editingUser ? editingUser.id : ''}" />
          <label>
            Nome
            <input name="name" required minlength="3" value="${editingUser ? escapeHtml(editingUser.name) : ''}" />
          </label>
          <label>
            Email
            <input name="email" type="email" required value="${editingUser ? escapeHtml(editingUser.email) : ''}" />
          </label>
          <label>
            Senha
            <input name="password" type="password" minlength="6" ${editingUser ? '' : 'required'} placeholder="${editingUser ? 'Preencha apenas para trocar' : 'Minimo 6 caracteres'}" />
          </label>
          <label>
            Perfil
            <select name="role">
              <option value="staff" ${editingUser?.role === 'staff' ? 'selected' : ''}>Operador</option>
              <option value="admin" ${editingUser?.role === 'admin' ? 'selected' : ''}>Administrador</option>
            </select>
          </label>
          <button type="submit" class="primary">${editingUser ? 'Salvar usuario' : 'Criar usuario'}</button>
          ${editingUser ? '<button type="button" data-action="cancel-user-edit">Cancelar</button>' : ''}
        </form>
      </div>

      <div>
        <h3>Usuarios cadastrados</h3>
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Email</th>
              <th>Perfil</th>
              <th>Ultimo login</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${users
              .map(
                (user) => `
              <tr>
                <td>${escapeHtml(user.name)}</td>
                <td>${escapeHtml(user.email)}</td>
                <td>${user.role === 'admin' ? 'Admin' : 'Operador'}</td>
                <td>${user.lastLoginAt ? dateTime(user.lastLoginAt) : '-'}</td>
                <td class="actions">
                  <button data-action="edit-user" data-id="${user.id}">Editar</button>
                </td>
              </tr>
            `,
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderMetrics(): string {
  if (!currentUser || currentUser.role !== 'admin') {
    return '<section class="panel"><p>Apenas administradores podem visualizar as metricas.</p></section>';
  }

  const metrics = getAccessMetrics();

  return `
    <section class="cards">
      <article class="card">
        <p>Logins (7 dias)</p>
        <h3>${metrics.recentLogins}</h3>
      </article>
      <article class="card">
        <p>Usuarios ativos (30 dias)</p>
        <h3>${metrics.activeUsers}</h3>
      </article>
      <article class="card">
        <p>Visualizacoes de paginas</p>
        <h3>${metrics.totalPageViews}</h3>
      </article>
      <article class="card">
        <p>Eventos registrados</p>
        <h3>${accessLogs.length}</h3>
      </article>
    </section>

    <section class="panel split">
      <div>
        <h3>Paginas mais acessadas</h3>
        <ul class="stats-list">
          ${
            metrics.topPages.length > 0
              ? metrics.topPages
                  .map(
                    ([page, count]) => `<li><span>${escapeHtml(page)}</span><strong>${count}</strong></li>`,
                  )
                  .join('')
              : '<li><span>Sem dados</span><strong>0</strong></li>'
          }
        </ul>
      </div>
      <div>
        <h3>Ultimos 20 eventos</h3>
        <ul class="timeline">
          ${accessLogs
            .slice(0, 20)
            .map(
              (log) => `
            <li>
              <p><strong>${escapeHtml(log.userName)}</strong> executou <strong>${escapeHtml(log.action)}</strong></p>
              <small>${dateTime(log.timestamp)} ${log.details ? `- ${escapeHtml(log.details)}` : ''}</small>
            </li>
          `,
            )
            .join('')}
        </ul>
      </div>
    </section>
  `;
}

function renderCurrentScreen(): string {
  switch (activeScreen) {
    case 'produtos':
      return renderProducts();
    case 'relatorios':
      return renderReports();
    case 'alertas':
      return renderAlerts();
    case 'historico':
      return renderHistory();
    case 'usuarios':
      return renderUsers();
    case 'metricas':
      return renderMetrics();
    case 'inicio':
    default:
      return renderHome();
  }
}

function renderApp(): void {
  if (!currentUser) {
    renderAuth();
    return;
  }

  const navItems: Array<{ id: Screen; label: string; adminOnly?: boolean }> = [
    { id: 'inicio', label: 'Inicio' },
    { id: 'produtos', label: 'Produtos' },
    { id: 'relatorios', label: 'Relatorios', adminOnly: true },
    { id: 'alertas', label: 'Alertas' },
    { id: 'historico', label: 'Historico' },
    { id: 'usuarios', label: 'Usuarios e permissoes', adminOnly: true },
    { id: 'metricas', label: 'Metricas de acesso', adminOnly: true },
  ];

  app.innerHTML = `
    <div class="layout ${currentUser.role === 'admin' ? 'layout-admin' : 'layout-staff'}">
      <aside class="sidebar reveal">
        <div>
          <p class="logo-tag">StockIa</p>
          <h2>${currentUser.role === 'admin' ? 'Gestao Central' : 'Operacao Loja'}</h2>
          <p class="caption">${escapeHtml(currentUser.name)}</p>
          <p class="caption">Perfil: ${currentUser.role === 'admin' ? 'Administrador' : 'Operador'}</p>
          <span class="role-chip ${currentUser.role === 'admin' ? 'admin' : 'staff'}">${currentUser.role === 'admin' ? 'Acesso administrativo' : 'Acesso operacional'}</span>
        </div>
        <nav>
          ${navItems
            .filter((item) => !item.adminOnly || currentUser?.role === 'admin')
            .map(
              (item) => `
              <button data-action="change-screen" data-screen="${item.id}" class="${activeScreen === item.id ? 'active' : ''}">
                ${item.label}
              </button>
            `,
            )
            .join('')}
        </nav>
        <button class="logout" data-action="logout">Sair</button>
      </aside>

      <main class="content reveal">
        <header class="header">
          <div>
            <h1>${screenTitle(activeScreen)}</h1>
            <p>${currentUser.role === 'admin' ? 'Visao executiva e gestao de equipe' : 'Visao operacional para abastecimento e estoque'}</p>
          </div>
          <div class="pill">Unidade Matriz</div>
        </header>

        ${renderCurrentScreen()}
      </main>
    </div>
  `;
}

async function handleAuthSubmit(form: HTMLFormElement): Promise<void> {
  const formData = new FormData(form);

  if (authMode === 'login') {
    const email = String(formData.get('email') ?? '').trim().toLowerCase();
    const password = String(formData.get('password') ?? '');

    const user = users.find((item) => item.email.toLowerCase() === email && item.password === password);

    if (!user) {
      authMessage = 'Email ou senha invalidos.';
      renderAuth();
      return;
    }

    currentUser = { ...user, lastLoginAt: new Date().toISOString() };
    users = users.map((item) => (item.id === user.id ? currentUser! : item));
    await repository.saveUsers(users);
    authMessage = '';
    activeScreen = 'inicio';
    renderApp();
    await logAction('login');
    await logAction('page_view', 'inicio');
    return;
  }

  const name = String(formData.get('name') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  const confirmPassword = String(formData.get('confirmPassword') ?? '');

  if (password !== confirmPassword) {
    authMessage = 'As senhas nao conferem.';
    renderAuth();
    return;
  }

  if (users.some((user) => user.email.toLowerCase() === email)) {
    authMessage = 'Ja existe usuario com este email.';
    renderAuth();
    return;
  }

  const newUser: AppUser = {
    id: id(),
    name,
    email,
    password,
    role: 'staff',
    createdAt: new Date().toISOString(),
  };

  users = [newUser, ...users];
  await repository.saveUsers(users);
  authMode = 'login';
  authMessage = 'Cadastro concluido. Agora faca login.';
  renderAuth();
}

async function handleProductSubmit(form: HTMLFormElement): Promise<void> {
  if (!currentUser) {
    return;
  }

  const formData = new FormData(form);
  const productId = String(formData.get('productId') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const category = String(formData.get('category') ?? '').trim();
  const unit = String(formData.get('unit') ?? '').trim() || defaultUnitForCategory(category);
  const barcode = String(formData.get('barcode') ?? '').trim();
  const imageUrl = String(formData.get('imageUrl') ?? '').trim();
  const quantity = Number(formData.get('quantity') ?? 0);
  const minQuantity = Number(formData.get('minQuantity') ?? 0);
  const price = Number(formData.get('price') ?? 0);

  if (!name) {
    return;
  }

  if (productId) {
    products = products.map((product) =>
      product.id === productId
        ? {
            ...product,
            name,
            category: category || product.category,
            unit: unit || product.unit,
            barcode: barcode || product.barcode,
            imageUrl: imageUrl || product.imageUrl,
            quantity,
            minQuantity,
            price,
            updatedAt: new Date().toISOString(),
          }
        : product,
    );
    editProductId = null;
    await logAction('update_product', name);
  } else {
    const now = new Date().toISOString();
    products = [
      {
        id: id(),
        name,
        category: category || undefined,
        unit: unit || undefined,
        barcode: barcode || undefined,
        imageUrl: imageUrl || undefined,
        quantity,
        minQuantity,
        price,
        createdBy: currentUser.id,
        createdAt: now,
        updatedAt: now,
      },
      ...products,
    ];
    await logAction('create_product', name);
  }

  await repository.saveProducts(products);
  renderApp();
}

async function handleUserSubmit(form: HTMLFormElement): Promise<void> {
  if (!currentUser || currentUser.role !== 'admin') {
    return;
  }

  const formData = new FormData(form);
  const userId = String(formData.get('userId') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  const role = (String(formData.get('role') ?? 'staff') === 'admin' ? 'admin' : 'staff') as UserRole;

  const duplicateEmail = users.find((user) => user.email.toLowerCase() === email && user.id !== userId);
  if (duplicateEmail) {
    alert('Ja existe usuario com este email.');
    return;
  }

  if (userId) {
    users = users.map((user) => {
      if (user.id !== userId) {
        return user;
      }

      return {
        ...user,
        name,
        email,
        role,
        password: password ? password : user.password,
      };
    });

    if (currentUser.id === userId) {
      currentUser = users.find((user) => user.id === userId) ?? currentUser;
    }
  } else {
    const newUser: AppUser = {
      id: id(),
      name,
      email,
      password: password || '123456',
      role,
      createdAt: new Date().toISOString(),
    };
    users = [newUser, ...users];
    await logAction('create_user', name);
  }

  editingUserId = null;
  await repository.saveUsers(users);
  renderApp();
}

app.addEventListener('submit', (event) => {
  const target = event.target;

  if (!(target instanceof HTMLFormElement)) {
    return;
  }

  event.preventDefault();

  if (target.id === 'auth-form') {
    void handleAuthSubmit(target);
    return;
  }

  if (target.id === 'product-form') {
    void handleProductSubmit(target);
    return;
  }

  if (target.id === 'user-form') {
    void handleUserSubmit(target);
  }
});

app.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const button = target.closest<HTMLButtonElement>('button[data-action]');

  if (!button) {
    return;
  }

  const action = button.dataset.action;

  if (action === 'set-auth-mode') {
    authMode = button.dataset.mode === 'register' ? 'register' : 'login';
    authMessage = '';
    renderAuth();
    return;
  }

  if (action === 'logout') {
    void logAction('logout');
    currentUser = null;
    editProductId = null;
    editingUserId = null;
    activeScreen = 'inicio';
    renderAuth();
    return;
  }

  if (action === 'change-screen' && currentUser) {
    const screen = button.dataset.screen as Screen | undefined;
    if (!screen) {
      return;
    }

    if ((screen === 'usuarios' || screen === 'metricas' || screen === 'relatorios') && currentUser.role !== 'admin') {
      return;
    }

    editProductId = null;
    editingUserId = null;
    activeScreen = screen;
    renderApp();
    void logAction('page_view', screen);
    return;
  }

  if (action === 'cancel-product-edit') {
    editProductId = null;
    renderApp();
    return;
  }

  if (action === 'edit-product') {
    const productId = button.dataset.id;
    if (!productId) {
      return;
    }
    editProductId = productId;
    renderApp();
    return;
  }

  if (action === 'delete-product') {
    const productId = button.dataset.id;
    if (!productId) {
      return;
    }

    const product = products.find((item) => item.id === productId);
    if (!product) {
      return;
    }

    const confirmed = confirm(`Excluir ${product.name}?`);
    if (!confirmed) {
      return;
    }

    products = products.filter((item) => item.id !== productId);
    void repository.saveProducts(products);
    void logAction('delete_product', product.name);
    renderApp();
    return;
  }

  if (action === 'edit-user') {
    const userId = button.dataset.id;
    if (!userId) {
      return;
    }
    editingUserId = userId;
    renderApp();
    return;
  }

  if (action === 'cancel-user-edit') {
    editingUserId = null;
    renderApp();
  }
});

app.addEventListener('input', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  const action = target.getAttribute('data-action');
  if (!action) return;

  if (action === 'search' && target instanceof HTMLInputElement) {
    searchQuery = target.value;
    renderApp();
  }

  if (action === 'filter' && target instanceof HTMLSelectElement) {
    const v = target.value as typeof productFilter;
    productFilter = v || 'all';
    renderApp();
  }
});

async function bootstrap(): Promise<void> {
  await seedInitialData();
  renderAuth();
}

void bootstrap();
