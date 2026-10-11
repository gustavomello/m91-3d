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
| `fontes/` | Arquivos originais: STL exportado do 3ds Max, PDFs do logo do Jardim dos Ipês, PNGs do logo M91. |

## Troféu: o que imprimir

Feito **uma vez**:

- `trofeu/trofeu-base.stl`: prédio + base, em pé, cor neutra.
- `trofeu/placas-fixas-1-fundo.stl` + `-2-amarelo-jardim-dos-ipes.stl` + `-3-azul-m91.stl`: importe os três juntos no fatiador ("objeto com várias partes": sim), uma cor por parte, impressão deitada.

Para **cada imobiliária**: abra *Personalizar troféu*, escolha o logo e a posição e baixe os 2 arquivos da placa (fundo + logo). Importe os dois juntos, do mesmo jeito.

Impressora de uma cor só: imprima as placas e pause na camada de **1,6 mm** para trocar o filamento.
As placas encaixam nos rebaixos com 0,2 mm de folga e são coladas.

## Alterar o troféu

- Medidas, folgas e regras de simplificação: `trofeu/gerar-base.js` (bloco `LAYOUT` no topo e função `simplificar`) e `trofeu/trofeu-lib.js` (`PLATE_T`, `PLATE_GAP`, `RELIEF_MM`, `MIN_FEATURE_MM`).
- Depois de mudar, abra *Gerar modelo-base de novo*.
- Se mudar `trofeu-lib.js` ou `personalizar.src.html`, rode `trofeu/build-personalizar.ps1` para atualizar `personalizar.html` (a versão com a biblioteca embutida).

## Arquivos grandes

`fontes/jardim-dos-ipes.stl` (107 MB) passa do limite do GitHub (100 MB) e está no `.gitignore`.
Guarde-o fora do Git (por exemplo, no OneDrive, onde esta pasta já está). Ele só é necessário para gerar o modelo-base de novo.
O arquivo original do 3ds Max (`.max`) não está nesta pasta.
