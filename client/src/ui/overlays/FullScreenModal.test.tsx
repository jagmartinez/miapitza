// @vitest-environment jsdom
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FullScreenModal, type ModalTab } from './FullScreenModal';
import { ConfirmDialog } from './ConfirmDialog';

function Harness({ dirty, onClose, tabs, onTabChange }: { dirty?: boolean; onClose: () => void; tabs?: ModalTab[]; onTabChange?: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Abrir</button>
      <FullScreenModal
        isOpen={open}
        title="Receta"
        dirty={dirty}
        tabs={tabs}
        activeTab={tabs?.[0].id}
        onTabChange={onTabChange}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
      >
        <input aria-label="Nombre" />
      </FullScreenModal>
    </>
  );
}

describe('FullScreenModal', () => {
  it('es hijo directo de document.body con aria-modal', async () => {
    render(<Harness onClose={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    const dlg = screen.getByRole('dialog');
    expect(dlg.parentElement).toBe(document.body);
    expect(dlg).toHaveAttribute('aria-modal', 'true');
  });

  it('Esc sin dirty llama onClose una vez', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Esc con dirty pide confirmación y solo cierra al descartar', async () => {
    const onClose = vi.fn();
    render(<Harness dirty onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.getByText('¿Descartar cambios?')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText('¿Descartar cambios?')).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Descartar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('el foco vuelve al botón que abrió el modal', async () => {
    render(<Harness onClose={() => {}} />);
    const opener = screen.getByRole('button', { name: 'Abrir' });
    await userEvent.click(opener);
    await userEvent.keyboard('{Escape}');
    expect(opener).toHaveFocus();
  });

  it('dirty + Cerrar pide confirmación; Descartar cierra y devuelve el foco', async () => {
    const onClose = vi.fn();
    render(<Harness dirty onClose={onClose} />);
    const opener = screen.getByRole('button', { name: 'Abrir' });
    await userEvent.click(opener);
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(screen.getByText('¿Descartar cambios?')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Descartar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(opener).toHaveFocus();
  });

  it('footer como función recibe requestClose y respeta dirty', async () => {
    const onClose = vi.fn();
    render(
      <FullScreenModal isOpen dirty title="X" onClose={onClose} footer={({ requestClose }) => <button onClick={requestClose}>Cancelar pie</button>}>
        <p>c</p>
      </FullScreenModal>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar pie' }));
    expect(screen.getByText('¿Descartar cambios?')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('flecha derecha cambia de pestaña', async () => {
    const onTabChange = vi.fn();
    render(<Harness onClose={() => {}} onTabChange={onTabChange} tabs={[{ id: 'primera', label: 'Primera' }, { id: 'siguiente', label: 'Siguiente' }]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    screen.getByRole('tab', { name: 'Primera' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onTabChange).toHaveBeenCalledWith('siguiente');
  });
});

describe('ConfirmDialog', () => {
  it('llama onConfirm y onCancel', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog isOpen title="Borrar" message="¿Seguro?" confirmLabel="Sí" onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sí' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('tone danger enfoca cancelar', () => {
    render(<ConfirmDialog isOpen tone="danger" title="Borrar" message="x" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus();
  });
});

describe('FullScreenModal compact', () => {
  it('adds the compact modifier for short dialogs', () => {
    render(<FullScreenModal isOpen onClose={() => {}} title="Aviso" size="compact"><p>x</p></FullScreenModal>);
    expect(screen.getByRole('dialog').className).toContain('ui-fsm--compact');
  });
});
