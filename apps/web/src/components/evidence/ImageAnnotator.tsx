import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, ColorSwatch, Group, Loader, Modal, SegmentedControl, Stack, Text, TextInput, Tooltip } from '@mantine/core';
import { IconArrowUpRight, IconArrowBackUp, IconHighlight, IconSquare, IconTextSize, IconTrash, IconNumber1 } from '@tabler/icons-react';
import { contentUrl, canvasToBlob, uploadDerivative, type Evidence } from './media';
import { toastError, toastOk } from '../ui';

type Tool = 'arrow' | 'rect' | 'highlight' | 'text' | 'step';
type Shape =
  | { t: 'arrow' | 'rect' | 'highlight'; x1: number; y1: number; x2: number; y2: number; color: string }
  | { t: 'text'; x: number; y: number; text: string; color: string }
  | { t: 'step'; x: number; y: number; n: number; color: string };

const COLORS = ['#e03131', '#f08c00', '#2f9e44', '#1971c2', '#000000'];

function draw(ctx: CanvasRenderingContext2D, img: HTMLImageElement, shapes: Shape[], draft: Shape | null) {
  const { width: W, height: H } = ctx.canvas;
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(img, 0, 0, W, H);
  const unit = Math.max(2, Math.round(Math.max(W, H) / 400));
  for (const s of draft ? [...shapes, draft] : shapes) {
    ctx.save();
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = unit * 1.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (s.t === 'rect') {
      ctx.strokeRect(Math.min(s.x1, s.x2), Math.min(s.y1, s.y2), Math.abs(s.x2 - s.x1), Math.abs(s.y2 - s.y1));
    } else if (s.t === 'highlight') {
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = s.color === '#000000' ? '#fcc419' : s.color;
      ctx.fillRect(Math.min(s.x1, s.x2), Math.min(s.y1, s.y2), Math.abs(s.x2 - s.x1), Math.abs(s.y2 - s.y1));
    } else if (s.t === 'arrow') {
      const ang = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
      const head = unit * 7;
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2 - Math.cos(ang) * head * 0.6, s.y2 - Math.sin(ang) * head * 0.6);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(s.x2, s.y2);
      ctx.lineTo(s.x2 - head * Math.cos(ang - Math.PI / 7), s.y2 - head * Math.sin(ang - Math.PI / 7));
      ctx.lineTo(s.x2 - head * Math.cos(ang + Math.PI / 7), s.y2 - head * Math.sin(ang + Math.PI / 7));
      ctx.closePath();
      ctx.fill();
    } else if (s.t === 'text') {
      const size = unit * 9;
      ctx.font = `600 ${size}px system-ui, "Segoe UI", sans-serif`;
      ctx.textBaseline = 'top';
      const w = ctx.measureText(s.text).width;
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(s.x - unit * 2, s.y - unit * 2, w + unit * 4, size + unit * 4);
      ctx.globalAlpha = 1;
      ctx.fillStyle = s.color;
      ctx.fillText(s.text, s.x, s.y);
    } else if (s.t === 'step') {
      const r = unit * 7;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = `700 ${Math.round(r * 1.1)}px system-ui, "Segoe UI", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(s.n), s.x, s.y + 1);
    }
    ctx.restore();
  }
}

/**
 * Draws arrows, boxes, highlights, numbered steps and labels on a copy of a
 * screenshot. Saving uploads an ANNOTATED derivative; the original image is
 * never modified (re-annotating starts again from the original).
 */
export function ImageAnnotator({ pid, item, opened, onClose, onSaved }: { pid: string; item: Evidence | null; opened: boolean; onClose: () => void; onSaved: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('arrow');
  const [color, setColor] = useState(COLORS[0]);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [draft, setDraft] = useState<Shape | null>(null);
  const [label, setLabel] = useState('');
  const [pendingText, setPendingText] = useState<{ x: number; y: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const nextStep = useMemo(() => shapes.filter((s) => s.t === 'step').length + 1, [shapes]);

  useEffect(() => {
    if (!opened || !item) return;
    setShapes([]);
    setDraft(null);
    setPendingText(null);
    setLoadError(null);
    setImg(null);
    const i = new Image();
    i.onload = () => setImg(i);
    i.onerror = () => setLoadError('The image could not be loaded for annotation.');
    i.src = contentUrl(pid, item.id);
  }, [opened, item, pid]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !img) return;
    if (c.width !== img.naturalWidth) {
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
    }
    draw(c.getContext('2d')!, img, shapes, draft);
  }, [img, shapes, draft]);

  const toImage = (e: React.PointerEvent) => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
  };

  const onDown = (e: React.PointerEvent) => {
    if (!img) return;
    const pt = toImage(e);
    if (tool === 'text') return setPendingText(pt);
    if (tool === 'step') return setShapes((s) => [...s, { t: 'step', x: pt.x, y: pt.y, n: nextStep, color }]);
    (e.target as Element).setPointerCapture(e.pointerId);
    setDraft({ t: tool, x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y, color });
  };
  const onMove = (e: React.PointerEvent) => {
    if (!draft || draft.t === 'text' || draft.t === 'step') return;
    const pt = toImage(e);
    setDraft({ ...draft, x2: pt.x, y2: pt.y });
  };
  const onUp = () => {
    if (draft && draft.t !== 'text' && draft.t !== 'step' && Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1) > 4) setShapes((s) => [...s, draft]);
    setDraft(null);
  };

  const save = async () => {
    if (!item || !canvasRef.current || !shapes.length) return;
    setSaving(true);
    try {
      draw(canvasRef.current.getContext('2d')!, img!, shapes, null);
      const blob = await canvasToBlob(canvasRef.current, 'image/png');
      const base = item.fileName.replace(/\.[^.]+$/, '');
      await uploadDerivative(pid, item.id, blob, { derivation: 'ANNOTATED', fileName: `${base}_annotated.png`, caption: item.caption ?? undefined });
      toastOk('Annotated copy saved — the original screenshot is unchanged');
      onSaved();
      onClose();
    } catch (e) {
      toastError(e, 'Could not save the annotation');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} size="90%" title={`Annotate · ${item?.displayName ?? item?.fileName ?? ''}`} centered>
      <Stack gap="sm">
        <Group justify="space-between" wrap="wrap">
          <Group gap="xs">
            <SegmentedControl
              size="xs"
              value={tool}
              onChange={(v) => setTool(v as Tool)}
              data={[
                { value: 'arrow', label: <Tooltip label="Arrow"><IconArrowUpRight size={16} aria-label="Arrow" /></Tooltip> },
                { value: 'rect', label: <Tooltip label="Rectangle"><IconSquare size={16} aria-label="Rectangle" /></Tooltip> },
                { value: 'highlight', label: <Tooltip label="Highlight"><IconHighlight size={16} aria-label="Highlight" /></Tooltip> },
                { value: 'step', label: <Tooltip label="Numbered step"><IconNumber1 size={16} aria-label="Numbered step" /></Tooltip> },
                { value: 'text', label: <Tooltip label="Text label"><IconTextSize size={16} aria-label="Text" /></Tooltip> },
              ]}
            />
            <Group gap={4}>
              {COLORS.map((c) => (
                <ColorSwatch key={c} color={c} size={20} component="button" type="button" onClick={() => setColor(c)} aria-label={`Colour ${c}`} style={{ cursor: 'pointer', outline: color === c ? '2px solid var(--mantine-color-explorix-5)' : undefined, outlineOffset: 2 }} />
              ))}
            </Group>
          </Group>
          <Group gap="xs">
            <Button size="xs" variant="default" leftSection={<IconArrowBackUp size={14} />} disabled={!shapes.length} onClick={() => setShapes((s) => s.slice(0, -1))}>
              Undo
            </Button>
            <Button size="xs" variant="default" color="red" leftSection={<IconTrash size={14} />} disabled={!shapes.length} onClick={() => setShapes([])}>
              Clear
            </Button>
          </Group>
        </Group>
        {loadError && <Alert color="red">{loadError}</Alert>}
        {!img && !loadError && (
          <Group justify="center" p="xl">
            <Loader />
          </Group>
        )}
        <div style={{ display: img ? 'flex' : 'none', justifyContent: 'center', background: 'var(--mantine-color-default-hover)', borderRadius: 6, padding: 8 }}>
          <canvas
            ref={canvasRef}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            style={{ maxWidth: '100%', maxHeight: '65vh', cursor: tool === 'text' ? 'text' : 'crosshair', touchAction: 'none' }}
            aria-label="Annotation canvas"
          />
        </div>
        {pendingText && (
          <Group gap="xs" align="flex-end">
            <TextInput
              label="Label text"
              value={label}
              onChange={(e) => setLabel(e.currentTarget.value)}
              autoFocus
              maxLength={120}
              style={{ flex: 1 }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && label.trim()) {
                  setShapes((s) => [...s, { t: 'text', ...pendingText, text: label.trim(), color }]);
                  setLabel('');
                  setPendingText(null);
                }
                if (e.key === 'Escape') setPendingText(null);
              }}
            />
            <Button
              disabled={!label.trim()}
              onClick={() => {
                setShapes((s) => [...s, { t: 'text', ...pendingText, text: label.trim(), color }]);
                setLabel('');
                setPendingText(null);
              }}
            >
              Add label
            </Button>
          </Group>
        )}
        <Group justify="space-between">
          <Text size="xs" c="dimmed">
            Annotations are saved as a separate copy at full resolution. Reports use the annotated copy when “Prefer annotated screenshots” is on.
          </Text>
          <Group gap="xs">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={save} loading={saving} disabled={!shapes.length}>
              Save annotated copy
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
