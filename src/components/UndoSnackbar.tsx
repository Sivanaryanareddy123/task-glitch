import { Snackbar, Button } from '@mui/material';
import { useEffect, useState } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  onUndo: () => void;
}

export default function UndoSnackbar({ open, onClose, onUndo }: Props) {
  // Track if we're in the undo flow
  const [isUndoing, setIsUndoing] = useState(false);

  // Reset state when snackbar closes
  useEffect(() => {
    if (!open) {
      setIsUndoing(false);
    }
  }, [open]);

  const handleUndo = () => {
    setIsUndoing(true); // Mark that we're undoing
    onUndo(); // Restore the task
    // Note: We DON'T call onClose() here anymore
    // The parent component should handle closing after undo
  };

  const handleClose = (event?: React.SyntheticEvent | Event, reason?: string) => {
    // Don't call onClose if we just performed an undo
    if (isUndoing) {
      setIsUndoing(false);
      return;
    }

    // Only call onClose for:
    // 1. Auto-hide (timeout)
    // 2. Clickaway
    // 3. Manual close (X button in MUI)
    if (reason === 'timeout' || reason === 'clickaway' || reason === 'escapeKeyDown') {
      onClose(); // This will clear lastDeleted
    }
  };

  return (
    <Snackbar
      open={open}
      onClose={handleClose}
      autoHideDuration={4000}
      message="Task deleted"
      action={
        <Button 
          color="secondary" 
          size="small" 
          onClick={handleUndo}
        >
          Undo
        </Button>
      }
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      // Disable clickaway close if you want more control
      ClickAwayListenerProps={{ 
        onClickAway: (event) => handleClose(event, 'clickaway')
      }}
    />
  );
}
