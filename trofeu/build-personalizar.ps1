# Gera personalizar.html (funciona aberto direto do disco) a partir de personalizar.src.html + trofeu-lib.js.
# Navegadores bloqueiam "import './arquivo.js'" em páginas abertas do disco, então a biblioteca é embutida.
$enc = New-Object System.Text.UTF8Encoding $false
$dir = $PSScriptRoot
$lib = [IO.File]::ReadAllText("$dir\trofeu-lib.js", $enc)
$lib = ($lib -split "`n" | Where-Object { $_ -notmatch '^\s*import ' }) -join "`n"
$names = ([regex]::Matches($lib, '(?m)^export (?:async function|function|const) (\w+)') | ForEach-Object { $_.Groups[1].Value }) -join ', '
$lib = [regex]::Replace($lib, '(?m)^export (async function|function|const)', '$1')
$inline = @"
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
    import * as BGU from 'three/addons/utils/BufferGeometryUtils.js';
    // Biblioteca do troféu embutida (gerada a partir de trofeu-lib.js por build-personalizar.ps1).
    const L = (() => {
$lib
      return { $names };
    })();
"@
$html = [IO.File]::ReadAllText("$dir\personalizar.src.html", $enc)
$marker = "import * as L from './trofeu-lib.js';"
if (-not $html.Contains($marker)) { throw "marcador não encontrado em personalizar.src.html" }
$html = $html.Replace($marker, $inline).Replace('<!-- Arquivo-fonte. O personalizar.html (usado de fato) é gerado com a biblioteca embutida: rode build-personalizar.ps1 -->', '<!-- Gerado por build-personalizar.ps1 a partir de personalizar.src.html. Edite o arquivo-fonte, não este. -->')
[IO.File]::WriteAllText("$dir\personalizar.html", $html, $enc)
"personalizar.html gerado (" + [int]((Get-Item "$dir\personalizar.html").Length / 1KB) + " KB); funções embutidas: $names"
