# oraculo-api

Backend do Oráculo — assistente conversacional sobre a infraestrutura de desenvolvimento
(documentação, conhecimento curado de especialistas, código-fonte, bancos e serviços).

Este serviço é o motor: mantém a sessão de chat, roda o laço de tool-calling, aplica as
camadas de segurança e conversa com o modelo através de um adaptador plugável.

## Stack

- Node.js 24 LTS (Krypton)
- NestJS 11
- TypeORM 1.x + PostgreSQL 17 (banco dedicado ao serviço)

## Princípios de arquitetura

- **Modelo é plugue.** `MODEL_PROVIDER=anthropic | openai-compat | cli` — trocar de modelo
  (API, endpoint local, ou um CLI agêntico) não muda nada além de uma variável.
- **Capacidade é módulo.** Conhecimento, código, banco e shell são módulos auto-contidos,
  ligados por ENV e recortados por perfil de usuário. O que o perfil não alcança nunca é
  sequer apresentado ao modelo.
- **Segurança fica no caminho, não ao lado.** Todo retorno de ferramenta passa pelo módulo
  de segurança: envelopado como dado inerte (nunca instrução), redigido de dado sensível e
  registrado na auditoria.
- **Uma instância por contexto.** Nada é compartilhado entre instâncias — nem banco, nem
  corpus, nem sessão.

## Rodando

```bash
nvm use            # Node 24 (.nvmrc)
npm install
cp .env.example .env
docker compose up -d       # oraculo-db (Postgres 17 + pgvector) na porta 5434
npm run migration:run
npm run start:dev
```

## Migrations

Sempre pelo CLI (`npm run migration:generate -- src/database/migrations/NomeDaMigration`),
nunca escrevendo o arquivo do zero.

⚠️ **Armadilha conhecida:** toda migration gerada vem com um
`DROP INDEX "public"."idx_trecho_embedding"` espúrio. O índice `ivfflat` do campo `embedding` não
existe no metamodelo do TypeORM (o decorator `@Index` só conhece btree/hash/gist/spgist/gin/brin),
então o diff o interpreta como índice órfão e propõe removê-lo — junto com o `down()` recriando
uma versão errada, sem `vector_cosine_ops`. **Apague as duas linhas antes de rodar a migration.**
O índice correto é criado uma única vez na `InicialSchema`:

```sql
CREATE INDEX "idx_trecho_embedding" ON "trecho"
  USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100)
```

## Contrato de eventos

`POST /chat` recebe um `PedidoChat` (`conversaId` opcional, `pergunta`, `escopo` opcional) e
responde via Server-Sent Events. Os tipos ficam em `src/contracts/eventos.ts` e são espelhados —
com os mesmos nomes de campo — em `oraculo-ui/src/types/eventos.ts`, importando os tipos de
domínio (`Fonte`, `Cobertura`, `Escopo`, `NomeFerramenta`, `StatusFerramenta`) de
`oraculo-ui/src/types/oraculo.ts`.

Cada evento é um `EventoOraculo`, discriminado pelo campo `tipo`:

| `tipo` | Carga |
|---|---|
| `mensagem.inicio` | `id`, `conversaId`, `modelo`, `escopo` |
| `ferramenta.inicio` | `id`, `nome`, `argumento`, `sensivel` |
| `ferramenta.fim` | `id`, `status`, `metrica`, `plano?`, `aprovadaPor?`, `resultado` |
| `texto.delta` | `fragmento` |
| `citacao` | `fonte` (objeto `Fonte` completo) |
| `aprovacao.pedido` | `id`, `comando`, `alvo`, `efeitoColateral`, `politica`, `expiraEm` |
| `mensagem.fim` | `cobertura`, `tokens`, `duracaoMs` |
| `erro` | `codigo`, `mensagem`, `retomavel` |

`serializarEvento(evento)` converte um `EventoOraculo` no frame SSE pronto:

```
event: <tipo>
data: <json>

```

### Marcador de citação `[[F:id]]`

Fragmentos de `texto.delta` podem conter marcadores no formato `[[F:id]]`, onde `id` referencia
o `id` de uma `Fonte` emitida (no mesmo turno) por um evento `citacao`. O front substitui cada
marcador por um chip clicável que abre o painel de fontes na fonte correspondente — a citação
pode chegar antes ou depois do trecho de texto que a referencia, então o front deve resolver o
marcador de forma tolerante à ordem de chegada.

## Front

O cliente web fica em [oraculo-ui](https://github.com/icaroMelo1/oraculo-ui).
