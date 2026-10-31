import * as vscode from 'vscode';

import { ANALYSIS_LIMITS, RENAME_LIMITS } from '../core/constants';
import type { MessageLocalizer } from '../core/messages';
import { newNameRefusal, renameAt, type NewNameRefusal, type RenameRefusal } from './alias-rename';
import { pastAnalysisLimits } from './macros';

/**
 * Rename Symbol (F2) on the alias of a sequence diagram's participant in a
 * Markdown block, as src/language/alias-rename.ts reads it.
 *
 * Markdown has a rename of its own, for headings and links, which VS Code
 * asks after this one, and which then answers on its own. So where the
 * cursor is on no participant's name, in a block or out of one, nothing is
 * answered here. On a participant's name that cannot be renamed, the reason
 * is given, and VS Code shows it with the reason of the Markdown rename.
 *
 * The document is read again when the edits are asked for, as it may have
 * changed since the name was found: what cannot be renamed then is refused
 * with its reason, and nothing is changed. A refusal there makes VS Code
 * ask the Markdown rename for edits at the same place, which has none to
 * make in a block.
 */

export interface AliasRenameDeps {
  l10n: MessageLocalizer;
  /** plantumlLocal.rename.enabled for a document. */
  enabled(document: vscode.Uri): boolean;
}

export class AliasRename implements vscode.RenameProvider {
  constructor(private readonly deps: AliasRenameDeps) {}

  prepareRename(
    document: vscode.TextDocument,
    position: vscode.Position
  ): { range: vscode.Range; placeholder: string } | undefined {
    if (!this.deps.enabled(document.uri)) {
      return undefined;
    }
    const text = document.getText();
    if (pastAnalysisLimits(text)) {
      return undefined;
    }
    const found = renameAt(text, position.line, position.character);
    if (found === null) {
      return undefined;
    }
    if ('refused' in found) {
      throw new Error(this.refusalText(found.refused));
    }
    const { line, start, end } = found.at;
    return { range: new vscode.Range(line, start, line, end), placeholder: found.alias };
  }

  provideRenameEdits(
    document: vscode.TextDocument,
    position: vscode.Position,
    newName: string,
    token: vscode.CancellationToken
  ): vscode.WorkspaceEdit | undefined {
    if (!this.deps.enabled(document.uri) || token.isCancellationRequested) {
      return undefined;
    }
    const { l10n } = this.deps;
    const text = document.getText();
    if (pastAnalysisLimits(text)) {
      throw new Error(
        l10n.t(
          'PlantUML Local does not rename in a document larger than {0} MiB or longer than {1} lines.',
          String(ANALYSIS_LIMITS.fileBytes / (1024 * 1024)),
          String(ANALYSIS_LIMITS.fileLines)
        )
      );
    }
    const found = renameAt(text, position.line, position.character);
    if (found === null) {
      throw new Error(l10n.t('PlantUML Local finds no alias of a participant to rename here.'));
    }
    if ('refused' in found) {
      throw new Error(this.refusalText(found.refused));
    }
    const refusal = newNameRefusal(found, newName);
    if (refusal !== null) {
      throw new Error(this.newNameText(refusal));
    }
    const edit = new vscode.WorkspaceEdit();
    if (newName === found.alias) {
      return edit;
    }
    for (const { line, start, end } of found.places) {
      edit.replace(document.uri, new vscode.Range(line, start, line, end), newName);
    }
    return edit;
  }

  private refusalText(refusal: RenameRefusal): string {
    const { l10n } = this.deps;
    switch (refusal.reason) {
      case 'unclosed':
        return l10n.t('PlantUML Local does not rename in a code block that has no closing fence.');
      case 'bounds':
        return l10n.t('PlantUML Local renames only in a code block that holds one diagram, from @startuml to @enduml.');
      case 'mapping':
        return l10n.t('PlantUML Local cannot match the lines of this code block to its diagram, and does not rename in it.');
      case 'line':
        return l10n.t(
          'PlantUML Local does not rename in this diagram: line {0} is not of a form it reads, so what the line names cannot be told.',
          String(refusal.line + 1)
        );
      case 'preprocessor':
        return l10n.t(
          'PlantUML Local does not rename in this diagram: line {0} is read by the preprocessor, which can bring in names that are not seen here.',
          String(refusal.line + 1)
        );
      case 'open':
        return l10n.t(
          'PlantUML Local does not rename in this diagram: the note, reference, style or group that starts on line {0} is not closed.',
          String(refusal.line + 1)
        );
      case 'undeclared':
        return l10n.t(
          'PlantUML Local does not rename {0}: it is not declared, so it is also the name the diagram shows. Give it an alias with as to rename it.',
          refusal.name
        );
      case 'without-as':
        return l10n.t(
          'PlantUML Local does not rename {0}: it is declared without as, so it is also the name the diagram shows. Give it an alias with as to rename it.',
          refusal.name
        );
      case 'declared-twice':
        return l10n.t('PlantUML Local does not rename {0}: it is declared more than once.', refusal.name);
      case 'not-ascii':
        return l10n.t(
          'PlantUML Local does not rename {0}: it renames only an alias of ASCII letters, digits and _, up to {1} characters long.',
          refusal.name,
          String(RENAME_LIMITS.nameLength)
        );
      case 'too-many':
        return l10n.t(
          'PlantUML Local does not rename {0}: it is used in more than {1} places.',
          refusal.name,
          String(RENAME_LIMITS.places)
        );
    }
  }

  private newNameText(refusal: NewNameRefusal): string {
    const { l10n } = this.deps;
    switch (refusal.reason) {
      case 'too-long':
        return l10n.t('PlantUML Local does not rename to a name longer than {0} characters.', String(RENAME_LIMITS.nameLength));
      case 'invalid':
        return l10n.t(
          'PlantUML Local does not rename to {0}: an alias is of ASCII letters, digits and _, and does not start with a digit.',
          refusal.name
        );
      case 'reserved':
        return l10n.t('PlantUML Local does not rename to {0}: it is a keyword of the diagram.', refusal.name);
      case 'taken':
        return l10n.t('PlantUML Local does not rename to {0}: a participant of the diagram has that name already.', refusal.name);
    }
  }
}
