import { redirect } from 'next/navigation'

// Individual session URLs (/workouts/:id) are no longer supported.
// The new coach training view at /admin/my-training handles all session data.
export default function WorkoutSessionPage() {
  redirect('/admin/my-training')
}
