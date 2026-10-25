import { useEffect } from 'react';
import { RichTextEditor, Link as RteLink } from '@mantine/tiptap';
import { useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';

/**
 * Rich-text editor (TipTap). Output is HTML; the server sanitizes all rich text on write.
 * `value` is only applied on mount or when `resetKey` changes so typing is never clobbered.
 */
export function RichText({
  value,
  onChange,
  placeholder,
  minHeight = 160,
  editable = true,
  resetKey,
  onEditor,
  autofocus,
  ariaLabel,
}: {
  value: string;
  onChange?: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
  editable?: boolean;
  resetKey?: unknown;
  onEditor?: (e: Editor | null) => void;
  autofocus?: boolean;
  ariaLabel?: string;
}) {
  const editor = useEditor({
    extensions: [StarterKit.configure({ link: false }), RteLink.configure({ openOnClick: false, autolink: true })],
    content: value,
    editable,
    autofocus: autofocus ? 'end' : false,
    editorProps: { attributes: { 'aria-label': ariaLabel ?? placeholder ?? 'Rich text editor', style: `min-height:${minHeight}px` } },
    onUpdate: ({ editor: e }) => onChange?.(e.isEmpty ? '' : e.getHTML()),
  });

  useEffect(() => {
    onEditor?.(editor);
  }, [editor, onEditor]);

  useEffect(() => {
    if (editor && resetKey !== undefined) editor.commands.setContent(value, { emitUpdate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey, editor]);

  useEffect(() => {
    editor?.setEditable(editable, false);
  }, [editable, editor]);

  return (
    <RichTextEditor editor={editor} variant="subtle">
      {editable && (
        <RichTextEditor.Toolbar sticky stickyOffset={0}>
          <RichTextEditor.ControlsGroup>
            <RichTextEditor.Bold />
            <RichTextEditor.Italic />
            <RichTextEditor.Strikethrough />
            <RichTextEditor.Code />
          </RichTextEditor.ControlsGroup>
          <RichTextEditor.ControlsGroup>
            <RichTextEditor.H3 />
            <RichTextEditor.BulletList />
            <RichTextEditor.OrderedList />
            <RichTextEditor.Blockquote />
            <RichTextEditor.CodeBlock />
          </RichTextEditor.ControlsGroup>
          <RichTextEditor.ControlsGroup>
            <RichTextEditor.Link />
            <RichTextEditor.Unlink />
          </RichTextEditor.ControlsGroup>
          <RichTextEditor.ControlsGroup>
            <RichTextEditor.Undo />
            <RichTextEditor.Redo />
          </RichTextEditor.ControlsGroup>
        </RichTextEditor.Toolbar>
      )}
      <RichTextEditor.Content />
    </RichTextEditor>
  );
}
