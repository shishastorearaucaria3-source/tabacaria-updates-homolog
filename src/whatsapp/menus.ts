import type { DatabaseSync } from 'node:sqlite';
import { getSettings } from './settings.js';

export function getTexts(db: DatabaseSync) {
  const settings = getSettings(db);

  return {
    menuPrincipal: [
      `👋 Olá! Seja bem-vindo à ${settings.storeName}!`,
      '',
      'Como posso ajudar?',
      '',
      '1️⃣ Ver produtos',
      '2️⃣ Consultar preço e estoque',
      '3️⃣ Fazer um pedido',
      '4️⃣ Consultar meu pedido',
      '5️⃣ Falar com atendente',
      '',
      'Digite o número da opção desejada.',
    ].join('\n'),

    askSearchTerm: '🔍 Digite o nome do produto que você procura:',
    noProducts: '😕 Não encontrei produtos publicados ainda. Tente novamente mais tarde.',
    categoriesHeader: '📦 Nossos produtos:\n\n',
    categoriesFooter: '\n\nDigite o número da categoria.\n0️⃣ Voltar',
    productsOfCategoryHeader: (category: string) => `📦 ${category}:\n\n`,
    productsOfCategoryFooter: '\n\nDigite o número do produto.\n0️⃣ Voltar',
    searchResultsHeader: (count: number) => `🔎 Encontrei ${count} produto(s):\n\n`,
    searchResultsFooter: '\n\nPode digitar o número ou o nome do produto.\n0️⃣ Voltar',
    recommendHeader: (term: string) => `🤔 Não encontrei exatamente "${term}".\n\nMas encontrei opções próximas disponíveis:\n\n`,
    recommendFooter: '\n\nDigite o nome do produto ou o número para adicionar ao carrinho.',
    singleFound: 'Você procura este produto?\n\n',

    productDetail: (p: { name: string; priceLabel: string; available: boolean; description?: string | null }) => {
      const lines = [
        '🔎 Encontrei:',
        '',
        `🔥 ${p.name}`,
        '',
        `💰 ${p.priceLabel}`,
        p.available ? '📦 Disponível' : '❌ Indisponível no momento',
        '',
        'Deseja:',
        '1️⃣ Comprar',
        '2️⃣ Ver outro produto',
        '0️⃣ Voltar',
      ];
      if (p.description) lines.splice(3, 0, `📝 ${p.description}`);
      return lines.join('\n');
    },

    productUnavailable: '❌ Este produto está indisponível no momento.',
    askQuantity: (name: string) => `🛒 ${name}\n\nQuantas unidades você deseja?`,
    itemAdded: (qty: number, name: string, subtotal: string) =>
      `✅ Adicionado: ${qty}x ${name} — ${subtotal}\n\nDigite menu para ver as opções ou continue pedindo.`,

    cartView: (lines: string[], total: string) =>
      ['🛒 Seu pedido:', '', ...lines, '', `💰 Total: R$ ${total}`].join('\n'),

    emptyCart: '🛒 Seu carrinho está vazio.',
    cartMenu: ['', '', '1️⃣ Adicionar produto', '2️⃣ Remover produto', '3️⃣ Finalizar pedido', '0️⃣ Cancelar pedido'].join('\n'),
    cartEmptyMenu: '🛒 Seu carrinho está vazio.\n\n1️⃣ Adicionar produto\n0️⃣ Voltar',
    removedItem: '🗑️ Produto removido do carrinho.',
    removedItemFail: 'Não encontrei esse número na lista de itens do carrinho.',
    orderCanceled: '❌ Pedido cancelado.\n\nDigite menu para começar novamente.',

    checkoutDelivery: [
      '🛵 Como deseja receber?',
      '',
      ...settings.delivery.options.map((o) => o.label),
      '',
      'Digite 1 ou 2.',
    ].join('\n'),

    checkoutPayment: [
      '💳 Formas de pagamento disponíveis:',
      '',
      ...settings.paymentMethods.map((m, i) => `${i + 1}️⃣ ${m}`),
      '',
      'Digite o número da forma desejada.',
    ].join('\n'),

    checkoutCpfAsk: settings.cpfRequired
      ? 'Para continuar, podemos cadastrar seus dados.\n\nQual é o seu CPF?'
      : 'Podemos cadastrar seu CPF para nota?\n\nDigite o CPF ou "pular".',

    cpfInvalid: '⚠️ CPF inválido. Digite apenas os 11 números, ou "pular".',

    orderSummary: (lines: string[], total: string, delivery: string, payment: string) =>
      [
        '📋 Confirme seu pedido:',
        '',
        ...lines,
        '',
        `💰 Total: R$ ${total}`,
        `🛵 ${delivery}`,
        `💳 ${payment}`,
        settings.delivery.freightNote,
        '',
        '1️⃣ Confirmar pedido',
        '0️⃣ Cancelar',
      ].join('\n'),

    orderConfirmed: (orderId: number) =>
      `✅ Pedido #${orderId} recebido!\n\nStatus: AGUARDANDO ATENDIMENTO\nEm breve entraremos em contato para confirmar pagamento e entrega.`,

    myOrdersHeader: '📦 Seus pedidos recentes:\n\n',
    myOrdersFooter: '\n\nDigite o número do pedido para detalhes.\n0️⃣ Voltar',
    myOrdersEmpty: 'Você ainda não tem pedidos registrados nesse número.',

    orderDetail: (o: { id: number; date: string; lines: string[]; total: string; status: string }) =>
      [
        `📦 Pedido #${o.id}`,
        `Data: ${o.date}`,
        '',
        ...o.lines,
        '',
        `💰 Total: R$ ${o.total}`,
        `📌 Status: ${o.status}`,
      ].join('\n'),

    handoff: '👤 Vou encaminhar você para um atendente.\n\nAguarde um momento.',

    unknownGeneric: [
      '🤔 Não consegui entender exatamente o que você precisa.',
      '',
      'Posso ajudar com:',
      '1️⃣ Ver produtos',
      '2️⃣ Consultar preço e estoque',
      '3️⃣ Fazer um pedido',
      '4️⃣ Consultar meu pedido',
      '5️⃣ Falar com atendente',
      '',
      'Ou escreva diretamente o que você procura.',
    ].join('\n'),

    unknownInState: (hint: string) =>
      ['🤔 Não consegui entender exatamente o que você precisa.', hint || '', 'Digite menu para voltar ao início.'].filter(Boolean).join('\n'),
  };
}

export const stateHints: Record<string, string> = {
  MENU_PRINCIPAL: 'Escolha de 1 a 5.',
  CATEGORIAS: 'Escolha uma categoria.',
  PRODUTOS_CATEGORIA: 'Escolha um produto.',
  LISTA_RESULTADOS: 'Digite o número do produto.',
  DETALHE_PRODUTO: 'Responda 1 (comprar), 2 (ver outro) ou 0 (voltar).',
  PEDIDO_QTD: 'Digite a quantidade.',
  MONTANDO_PEDIDO: 'Escolha 1, 2, 3 ou 0.',
  CHECKOUT_NOME: 'Digite seu nome.',
  CHECKOUT_ENTREGA: 'Digite 1 (retirada) ou 2 (entrega).',
  CHECKOUT_ENDERECO: 'Digite o endereço.',
  CHECKOUT_PAGAMENTO: 'Escolha a forma de pagamento.',
  CHECKOUT_CPF: 'Digite o CPF ou "pular".',
  CHECKOUT_CONFIRMAR: '1 confirma, 0 cancela.',
  MEUS_PEDIDOS: 'Digite o número do pedido ou 0.',
};
