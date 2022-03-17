import {
  Button,
  Card,
  CardActions,
  CardContent,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Skeleton,
  TextField,
  Toolbar,
  Typography,
} from '@mui/material';
import * as React from 'react';
import { LoadingButton } from '@mui/lab';
import { Box } from '@mui/system';
import client from '../api';
import DialogForm from './DialogForm';
import { App } from '../../prisma/generated/client';
import StudioAppBar from './StudioAppBar';

export interface CreateAppDialogProps {
  open: boolean;
  onClose: () => void;
}

function CreateAppDialog({ onClose, ...props }: CreateAppDialogProps) {
  const [name, setName] = React.useState('');
  const createAppMutation = client.useMutation('createApp');

  return (
    <Dialog {...props} onClose={onClose}>
      <DialogForm
        onSubmit={async (event) => {
          event.preventDefault();

          const app = await createAppMutation.mutateAsync([name]);
          window.location.href = `/_studio/app/${app.id}/editor`;
        }}
      >
        <DialogTitle>Create a new MUI Studio App</DialogTitle>
        <DialogContent>
          <TextField
            sx={{ my: 1 }}
            autoFocus
            fullWidth
            label="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <LoadingButton type="submit" loading={createAppMutation.isLoading} disabled={!name}>
            Create
          </LoadingButton>
        </DialogActions>
      </DialogForm>
    </Dialog>
  );
}

interface AppCardProps {
  app?: App;
}

function AppCard({ app }: AppCardProps) {
  return (
    <Card sx={{ gridColumn: 'span 1' }}>
      <CardContent>
        <Typography gutterBottom variant="h5" component="div">
          {app ? app.name : <Skeleton />}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {app ? `Some app description for "${app.name}" here` : <Skeleton />}
        </Typography>
      </CardContent>
      <CardActions>
        <Button
          size="small"
          component="a"
          href={app ? `/_studio/app/${app.id}/editor` : ''}
          disabled={!app}
        >
          Edit
        </Button>
        <Button size="small" component="a" href={app ? `/deploy/${app.id}` : ''} disabled={!app}>
          open
        </Button>
      </CardActions>
    </Card>
  );
}

export default function Home() {
  const { data: apps = [], status, error } = client.useQuery('getApps', []);

  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);

  return (
    <React.Fragment>
      <StudioAppBar navigation={null} actions={null} />
      <Container>
        <Typography variant="h2">Apps</Typography>
        <CreateAppDialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} />

        <Toolbar disableGutters>
          <Button onClick={() => setCreateDialogOpen(true)}>Create New</Button>
        </Toolbar>

        <Box
          sx={{
            my: 5,
            display: 'grid',
            gridTemplateColumns: {
              lg: 'repeat(4, 1fr)',
              md: 'repeat(3, 1fr)',
              sm: 'repeat(2, fr)',
              xs: 'repeat(1, fr)',
            },
            gap: 2,
          }}
        >
          {(() => {
            switch (status) {
              case 'loading':
                return <AppCard />;
              case 'error':
                return (error as Error)?.message;
              case 'success':
                return apps.length > 0
                  ? apps.map((app) => <AppCard key={app.id} app={app} />)
                  : 'No apps yet';
              default:
                return '';
            }
          })()}
        </Box>
      </Container>
    </React.Fragment>
  );
}