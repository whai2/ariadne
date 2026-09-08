# MCP 파일시스템 샌드박스

이 폴더는 스튜디오의 **파일시스템 에이전트**가 열어 보는 유일한 곳이다.

에이전트는 기성 MCP 서버 `@modelcontextprotocol/server-filesystem`(공식 레퍼런스, npx로 뜬다)에
붙어서 이 폴더의 파일을 읽고 쓴다 — 우리가 만든 데모 서버가 아니라 **남이 만든 진짜 서버**다.

## 왜 전용 폴더인가

그 서버는 `write_file`·`edit_file`·`move_file` 같은 **파일을 바꾸는 툴**도 준다. 아직 툴 실행을
사람이 막을 승인 게이트가 없어서(ROADMAP의 다음 단계), 에이전트가 건드릴 수 있는 범위를
이 샌드박스로 좁혀 둔다. 실제 프로젝트 파일은 열지 않는다.

## 해볼 것

- "이 폴더에 무슨 파일이 있어?" → `list_directory`
- "notes.md 요약해줘" → `read_text_file`
- "todo.md에 줄 하나 추가해줘" → `edit_file` / `write_file`
