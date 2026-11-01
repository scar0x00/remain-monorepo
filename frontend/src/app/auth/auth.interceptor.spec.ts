import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AUTH_CLIENT } from './auth-client';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from './auth.service';
import { ADA, createFakeAuthClient } from './fake-auth-client';

describe('authInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let navigate: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: AUTH_CLIENT, useValue: createFakeAuthClient({ user: ADA }).client },
      ],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await TestBed.inject(AuthService).ready();
  });

  it('signs the user out locally and goes to the login page on a 401 from the API', async () => {
    const request = firstValueFrom(http.get('/api/v1/decks'));
    backend.expectOne('/api/v1/decks').flush('Sign in', { status: 401, statusText: 'Unauthorized' });

    await expect(request).rejects.toMatchObject({ status: 401 });
    expect(TestBed.inject(AuthService).isAuthenticated()).toBe(false);
    expect(navigate).toHaveBeenCalledWith(['/login'], { queryParams: { returnTo: '/' } });
  });

  it('leaves other errors alone', async () => {
    const request = firstValueFrom(http.get('/api/v1/decks'));
    backend.expectOne('/api/v1/decks').flush('nope', { status: 404, statusText: 'Not Found' });

    await expect(request).rejects.toMatchObject({ status: 404 });
    expect(TestBed.inject(AuthService).isAuthenticated()).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });
});
