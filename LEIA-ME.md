# Frete ANTT – Grupo Cereal (PWA)

App instalável no Android para montar rotas de entrega até as fazendas e calcular o **piso mínimo de frete da ANTT**.

## Funções
- **Origem:** Grupo Cereal Rio Verde/GO ou Palmeiras de Goiás/GO.
- **Destinos:** as 980 fazendas do `Fazendas.kmz` já vêm no app, no arquivo `fazendas-padrao.js`, e aparecem na busca de Paradas e no mapa. Também dá para importar outra lista de KMZ/KML (Google Earth, Maps.me) ou Excel/CSV com colunas de nome, latitude e longitude, ou tocar no mapa e adicionar um ponto livre.
- **Rota por estrada** (OSRM/OpenStreetMap), com distância e tempo de cada trecho. Há a opção de voltar à origem e um botão "Abrir no Google Maps" para o motorista.
- **Várias paradas com otimização da ordem:** busca exata até 8 paradas; acima disso, vizinho mais próximo seguido de 2-opt.
- **Piso mínimo ANTT:** considera o tipo de carga, os eixos, se é composição veicular, se é alto desempenho e se há retorno vazio. Também mostra pedágio, R$/km e R$/t.
- **Cotação**, na aba Frete:
  - **Compartilhar** envia um texto formatado pelo WhatsApp ou por outro app do celular.
  - **PDF** abre a impressão; no Android, escolha "Salvar como PDF".
  - **Salvar** guarda a cotação no histórico do aparelho (até 100), de onde dá para reenviar ou excluir.
- **Km e frete de todas as fazendas**, na aba Fazendas:
  - **Calcular todas** busca a distância por estrada de cada fazenda até as duas unidades e escolhe a mais próxima. Para 980 fazendas, leva cerca de 15 segundos.
  - **Exportar Excel** gera uma planilha com km, tempo, unidade mais próxima, CCD, CC, ida, retorno vazio, piso, R$/km e R$/t. O piso usa as opções da aba Frete no momento da exportação: mude o número de eixos e exporte de novo.
  - A planilha também traz uma aba "Parâmetros", com a norma e a fonte.
  - O tempo vem do OSRM, que calcula para carro. Para caminhão, o tempo real é maior.

## Fórmula (Resolução ANTT nº 5.867/2020)
- Ida = Distância × CCD + CC
- Retorno vazio = 0,92 × Distância × CCD
- A distância é em km inteiros, como na calculadora oficial. O valor total é arredondado só no final.
- Tabela A: composição/lotação. B: só o veículo automotor. C e D: as mesmas operações em alto desempenho.
- Os coeficientes vêm da calculadora oficial (https://calculadorafrete.antt.gov.br/): Resolução 5.867/2020, atualizada em 30/09/2026 pela PORT.SUROC Nº 22/2026, consultada em 29/10/2026.
- O piso **não inclui** diárias, impostos, seguro e outros itens negociáveis. O pedágio deve ser somado ao piso.

## Atualizar a tabela ANTT
1. No PC, rode `python ferramentas/atualizar_tabela_antt.py`. São cerca de 336 consultas à calculadora oficial, em torno de 6 minutos, e o script regrava `antt-tabela.js`.
2. Publique a pasta de novo. O app baixa a tabela nova quando abrir com internet.
3. Alternativa: na aba **Tabela ANTT** do app, importe um JSON com o mesmo formato.

## Atualizar a lista de fazendas que vem no app
1. Exporte o KMZ atualizado (Maps.me ou Google Earth).
2. Rode `python ferramentas/embutir_fazendas.py "C:\Users\rvnat\Downloads\Fazendas.kmz"`. O script regrava `fazendas-padrao.js`.
3. Publique o novo `fazendas-padrao.js`.
4. Num aparelho que tinha importado outra lista, toque em "Apagar importadas e voltar à lista do app" para usar a nova.

**Privacidade:** com o app num site público, como o GitHub Pages grátis, qualquer pessoa que tiver o endereço consegue baixar `fazendas-padrao.js`. Esse arquivo tem nomes, coordenadas e observações das fazendas. Para restringir o acesso, use um repositório privado: o GitHub Pages privado exige plano pago. Outra saída é não publicar esse arquivo e importar o KMZ em cada aparelho.

## Testar no PC
```
python -m http.server 8765 --directory frete-antt-pwa
```
Depois abra http://localhost:8765.

## Instalar no Android
Para instalar como app, o PWA precisa estar num endereço **HTTPS**. Opções gratuitas:
- **GitHub Pages:** crie um repositório, envie o conteúdo desta pasta e ative Pages em Settings → Pages.
- **Netlify Drop** (https://app.netlify.com/drop): arraste esta pasta.
- **Cloudflare Pages:** também funciona.

No celular, abra o endereço no Chrome e use o menu ⋮ → **Instalar app** (ou "Adicionar à tela inicial").

As fazendas **não** ficam no servidor. Cada aparelho importa o KMZ ou a planilha na aba Fazendas, e os dados ficam salvos só nele.

## Limitações
- As rotas usam o servidor público de demonstração do OSRM. Ele é gratuito, mas sem garantia de disponibilidade e pode ser lento. Para uso intenso, vale contratar um serviço próprio, como OSRM próprio, OpenRouteService ou GraphHopper.
- Rotas e mapa precisam de internet. O cálculo do frete e a tabela funcionam offline depois da primeira abertura.
