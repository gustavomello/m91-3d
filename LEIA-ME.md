# M91 3D

Visualizador 3D e troféu impresso em 3D do Jardim dos Ipês. Separado do site da M91 (`novo site m91`).

## Como abrir

Dois cliques em **`iniciar.cmd`**. Ele liga um servidor local e abre o navegador em `http://localhost:8093/`.
Feche a janela preta para desligar.

O servidor é necessário porque os navegadores não deixam páginas abertas direto do disco lerem arquivos 3D.
(A exceção é `trofeu/personalizar.html`, que também funciona com dois cliques: ela pede os arquivos do modelo-base.)

## Pastas

| Pasta | O que tem |
|---|---|
| `visualizador/` | Página do visualizador 3D (`index.html`) e o modelo comprimido (`modelos/jardim-dos-ipes.drc`). Pode ser publicada como site estático. |
| `trofeu/` | Gerador do modelo-base, ferramenta de personalização e os STL para imprimir. |
| `fontes/` | Arquivos originais: STL exportado do 3ds Max, PDFs do logo do Jardim dos Ipês, PNGs do logo M91 e o logo da Refugium Imobiliária (PNG original + SVG vetorizado), usado como exemplo de 1º lugar. |

## Troféu: o que imprimir

Feito **uma vez**:

- `trofeu/trofeu-base.stl`: prédio + base, em pé, cor neutra.
- `trofeu/placas-fixas-1-fundo.stl` + `-2-amarelo-jardim-dos-ipes.stl` + `-3-azul-m91.stl`: importe os três juntos no fatiador ("objeto com várias partes": sim), uma cor por parte, impressão deitada.

Para **cada imobiliária**: abra *Personalizar troféu*, escolha o logo e a posição e baixe os 2 arquivos da placa (fundo + logo). Importe os dois juntos, do mesmo jeito.

Impressora de uma cor só: imprima as placas e pause na camada de **1,6 mm** para trocar o filamento.
As placas encaixam nos rebaixos com 0,2 mm de folga e são coladas.

## Alterar o troféu

O troféu é gerado em duas fases (código em `trofeu/gerar-base.js`):

1. **Preparar prédio** (`trofeu/preparar.html`): corta 1 dos 4 prédios do modelo original, simplifica para impressão (remove as gaiolas de gás, as pingadeiras e os peitoris, transforma os guarda-corpos em placas sólidas) e fecha a empena.
   Grava `trofeu/predio-simplificado.stl` + `.json`. Só rode de novo se mudar o STL original, o bloco `PREPARO` ou a função `simplificar`. É a única etapa que precisa do STL de 107 MB.
2. **Gerar modelo-base** (`trofeu/gerar.html`): parte do prédio preparado e monta a base, os rebaixos (inclusive o do símbolo M91 na empena) e as placas fixas. Medidas no bloco `LAYOUT` e em `trofeu/trofeu-lib.js` (`PLATE_T`, `PLATE_GAP`, `RELIEF_MM`, `MIN_FEATURE_MM`).
   Se mudar `PLATE_T`, prepare o prédio de novo (o miolo da empena depende dele).

- Depois de mudar algo, abra a fase correspondente (ou as duas, em ordem).
- Se mudar `trofeu-lib.js` ou `personalizar.src.html`, rode `trofeu/build-personalizar.ps1` para atualizar `personalizar.html` (a versão com a biblioteca embutida).

## Arquivos grandes

`fontes/jardim-dos-ipes.stl` (107 MB) passa do limite do GitHub (100 MB) e está no `.gitignore`.
Guarde-o fora do Git (por exemplo, no OneDrive, onde esta pasta já está). Ele só é necessário para *Preparar prédio*.
O arquivo original do 3ds Max (`.max`) não está nesta pasta.
