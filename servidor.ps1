# Servidor local do projeto M91 3D (visualizador + troféu).
# Uso: dois cliques em iniciar.cmd   (ou: powershell -ExecutionPolicy Bypass -File servidor.ps1 [-Porta 8093] [-Abrir])
# Fica rodando enquanto a janela estiver aberta. Feche a janela para desligar.
param([int]$Porta = 8093, [switch]$Abrir)

$Raiz = $PSScriptRoot
$tipos = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'; '.md' = 'text/plain; charset=utf-8'
  '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.webp' = 'image/webp'; '.svg' = 'image/svg+xml'; '.ico' = 'image/x-icon'
  '.pdf' = 'application/pdf'; '.stl' = 'model/stl'; '.drc' = 'application/octet-stream'
}
# pastas onde as páginas podem gravar arquivos gerados (gerar.html)
$gravaveis = @('trofeu', 'visualizador/modelos')

$http = New-Object System.Net.HttpListener
$http.Prefixes.Add("http://localhost:$Porta/")
try { $http.Start() } catch { Write-Host "Não consegui usar a porta $Porta. Tente: servidor.ps1 -Porta 8094" -ForegroundColor Red; Read-Host 'Enter para sair'; exit 1 }
Write-Host ""
Write-Host "  M91 3D rodando em  http://localhost:$Porta/" -ForegroundColor Cyan
Write-Host "  Feche esta janela para desligar."
Write-Host ""
if ($Abrir) { Start-Process "http://localhost:$Porta/" }

while ($http.IsListening) {
  $ctx = $http.GetContext()
  $req = $ctx.Request; $res = $ctx.Response
  try {
    $caminho = [Uri]::UnescapeDataString($req.Url.AbsolutePath).TrimStart('/')

    # gravação de arquivos gerados: PUT /__save/<pasta permitida>/<nome-simples.ext>
    if ($req.HttpMethod -eq 'PUT' -and $caminho -match '^__save/(.+)/([A-Za-z0-9\-]+\.(stl|json|drc))$' -and $gravaveis -contains $Matches[1]) {
      $pasta = Join-Path $Raiz $Matches[1]; $nome = $Matches[2]
      $ms = New-Object IO.MemoryStream; $req.InputStream.CopyTo($ms)
      [IO.File]::WriteAllBytes((Join-Path $pasta $nome), $ms.ToArray())
      Write-Host "  salvo: $($Matches[1])/$nome ($([math]::Round($ms.Length / 1KB)) KB)"
      $res.StatusCode = 204; $res.Close(); continue
    }

    if ($caminho -eq '' -or $caminho.EndsWith('/')) { $caminho += 'index.html' }
    $arquivo = [IO.Path]::GetFullPath((Join-Path $Raiz $caminho))
    # não deixa sair da pasta do projeto
    if (-not $arquivo.StartsWith($Raiz, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $arquivo -PathType Leaf)) {
      $res.StatusCode = 404; $res.Close(); continue
    }
    $bytes = [IO.File]::ReadAllBytes($arquivo)
    $ext = [IO.Path]::GetExtension($arquivo).ToLower()
    $res.ContentType = $(if ($tipos[$ext]) { $tipos[$ext] } else { 'application/octet-stream' })
    $res.Headers.Add('Cache-Control', 'no-cache')
    $res.ContentLength64 = $bytes.Length
    # HEAD pede só os cabeçalhos (o leitor de PDF usa isso)
    if ($req.HttpMethod -ne 'HEAD') { $res.OutputStream.Write($bytes, 0, $bytes.Length) }
  } catch { Write-Host "  erro: $_" -ForegroundColor Yellow; try { $res.StatusCode = 500 } catch {} }
  try { $res.Close() } catch {}
}
