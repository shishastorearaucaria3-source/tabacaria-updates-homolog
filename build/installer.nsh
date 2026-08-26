; NSIS custom para o instalador NossoSistema-Setup (assistente com pasta escolhível).
; Pasta padrão sugerida: C:\NossoSistema. O usuário pode alterar na tela do instalador.
; A aplicação NÃO usa este caminho em runtime — ela descobre sua própria pasta via
; dirname(process.execPath). Este valor é apenas o diretório inicial do instalador.

!macro customInit
  ; Se o usuário/autoupdate informou /D=<pasta> na linha de comando, respeita.
  ; Se NÃO informou, define o diretório padrão sugerido: C:\NossoSistema.
  Push $R0
  !insertmacro GetDParameter $R0
  ${If} $R0 == ""
    StrCpy $INSTDIR "C:\NossoSistema"
  ${EndIf}
  Pop $R0
!macroend

; NÃO conceder ACL ampla aqui. O launcher concede permissão de escrita APENAS ao
; usuário atual (não ao grupo "Users") após copiar os arquivos — necessário para
; o autoupdate substituir arquivos sem elevação. Demais usuários ficam sem escrita.
!macro customInstall
!macroend