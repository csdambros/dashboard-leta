# Server1 · Painel de recursos

Projeto Quarto com a interface original do painel Server1. Todos os cálculos, filtros, alertas e gráficos são feitos em JavaScript no navegador. Não depende de Shiny, Node, npm, R ou Apps Script em execução. Requer Quarto para renderizar e um servidor HTTP para servir o resultado.

## Testar

1. Abra `painel-server1.Rproj` no RStudio ou abra um terminal nesta pasta.
2. Execute `quarto preview`. Os dados iniciais são exemplos fictícios, sinalizados na interface.
3. Use `quarto render` para gerar `_site/`. Não abra o HTML com `file://`, pois o navegador pode bloquear a leitura dos CSVs.

A página usa o mesmo HTML, CSS e funções de apresentação do painel original. O Quarto funciona como gerador e empacotador da página. Não usamos o layout dashboard padrão do Quarto para evitar modificar a interface.

## Usar os dados reais

Em `assets/config.js`, mude `source: "examples"` para `source: "data"`. Copie os quatro logs para `data/`, renderize e sirva `_site/` na rede interna. Também pode configurar `dataUrl` para outro caminho no mesmo servidor HTTP. Um endereço em outro domínio requer CORS. Dados acessíveis ao navegador são acessíveis a quem puder visitar esse endereço; restrinja o acesso pelo servidor/rede.

Depois de renderizar, atualize os arquivos diretamente em `_site/data/` (ou no diretório publicado equivalente). Não precisa renderizar novamente a cada coleta. O navegador consulta os quatro arquivos a cada 60 segundos, evita consultas sobrepostas, mantém filtros e preserva o último conjunto válido caso a consulta falhe. Abas ocultas pausam a consulta e atualizam ao retornar. Importação manual e botão de exemplos pausam a atualização; o botão Atualizar retoma a fonte configurada.

Exemplo de publicação dos logs existentes:

```bash
python3 scripts/publish_csv.py --source /home/pi/server_logs --destination /var/www/painel/data
```

O script só copia arquivos: não coleta recursos e não substitui seu cron atual. Publica cada CSV por renomeação atômica para evitar leitura de um arquivo pela metade. Os quatro arquivos não formam uma transação única; as datas de coleta podem ser distintas. Configure o cron da coleta/publicação conforme necessário. Evite executar `du` a cada minuto; memória/disco podem ter coleta mais frequente que uso por usuário.

## Formatos aceitos

Vírgula ou ponto e vírgula como separador, UTF-8, números decimais com ponto ou vírgula.

| Arquivo | Formato do servidor aceito |
|---|---|
| user_disk_usage.csv | timestamp,user,home,used_bytes ou timestamp,user,home_used_kb |
| user_quotas.csv | timestamp,user,uid,used_bytes,soft_bytes,hard_bytes,grace |
| disk_summary.csv | timestamp,filesystem,size_bytes,used_bytes,available_bytes,use_percent,mount |
| memory_summary.csv | timestamp,type,total,used,free,shared,buff_cache,available; type Mem/Swap; valores em bytes |

Também aceita os formatos em GiB de `examples/`. Também aceita o export legado sem cabeçalho usado no painel anterior: timestamp,user,flags,used_kb,soft_kb,hard_kb,grace (valores em KiB). Para novos arquivos, prefira cabeçalho e unidades explícitas. Quota zero significa sem limite. O uso da pasta e o uso contabilizado pela quota podem diferir; a interface preserva a regra original de priorizar o uso da pasta quando disponível.

Para memória, um CSV com várias datas mostra a série completa; um snapshot gera um histórico temporário nesta aba (até 240 amostras). Esse histórico é perdido ao recarregar. Para histórico permanente, mantenha registros no CSV; agrupamos Mem/Swap pela mesma data. Um único registro não representa um histórico completo.

## GitHub: somente código

Crie um repositório e envie a pasta extraída, incluindo `.gitignore`. Não habilite GitHub Pages. `_site/`, HTML gerado, dados reais, chaves e arquivos locais do RStudio estão ignorados. `assets/scripts.html` é um fragmento de código fonte necessário, não uma página publicada. Os exemplos fictícios podem ser versionados. Não há workflow de publicação automática. `.gitignore` não remove arquivos que já estiverem sendo rastreados por um repositório antigo.

## Verificação

O pacote mantém os arquivos da interface original e inclui verificação de JavaScript e CSVs. Renderização/inspeção visual final depende do Quarto instalado no seu computador. Não foram incluídos dados reais nem credenciais.
