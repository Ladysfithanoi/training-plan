import { redirect } from 'next/navigation'

// The old /workouts page is retired. All traffic is permanently routed to
// the new coach training dashboard at /admin/my-training.
export default function WorkoutsPage() {
  redirect('/admin/my-training')
}
