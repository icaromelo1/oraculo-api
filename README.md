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
npm run start:dev
```

## Front

O cliente web fica em [oraculo-ui](https://github.com/icaroMelo1/oraculo-ui).
