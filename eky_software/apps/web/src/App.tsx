import { CustomerPage } from './customers/CustomerPage.js';
import { AppLayout } from './layout/AppLayout.js';

export function App(): React.JSX.Element {
  return (
    <AppLayout>
      <CustomerPage />
    </AppLayout>
  );
}
