import isomorphicFetch from 'isomorphic-fetch';
import { Rx } from 'rx';
import url from 'url';

type Options = {
  oothUrl: string;
  standalone?: boolean;
  apiLoginUrl?: string;
  apiLogoutUrl?: string;
};

type User = {
  _id: string;
};

export class OothClient {
  private oothUrl: string;
  private standalone: boolean;
  private apiLoginUrl?: string;
  private apiLogoutUrl?: string;
  private started: boolean = false;
  private userSubject?: Rx.BehaviorSubject;

  constructor({ oothUrl, standalone, apiLoginUrl, apiLogoutUrl }: Options) {
    this.oothUrl = oothUrl;
    this.standalone = !!standalone;
    if (standalone) {
      this.apiLoginUrl = apiLoginUrl;
      this.apiLogoutUrl = apiLogoutUrl;
    }
  }

  public async start(): Promise<User> {
    if (!this.started) {
      this.started = true;
      this.user();
      this.subscribeStatus();
      return await this.status();
    }

    return this.user().getValue();
  }

  public user(): Rx.BehaviorSubject {
    if (!this.userSubject) {
      this.userSubject = new Rx.BehaviorSubject(null);
    }
    return this.userSubject;
  }

  public async authenticate(strategy: string, method: string, body: any): Promise<User | null> {
    const raw = isomorphicFetch(`${this.oothUrl}/${strategy}/${method}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: body && JSON.stringify(body),
      credentials: 'include',
    });
    const response = await raw.json();
    if (response.status === 'error') {
      throw new Error(response.message);
    }
    const { user, token } = response;
    if (this.standalone) {
      await isomorphicFetch(this.apiLoginUrl, {
        method: 'POST',
        headers: {
          Authorization: `JWT ${token}`,
        },
        credentials: 'include',
      });
    }
    return this.next(user);
  }

  public async method<T>(strategy: string, method: string, body: any): Promise<T> {
    const raw = await isomorphicFetch(`${this.oothUrl}/${strategy}/${method}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      credentials: 'include',
    });
    const response = await raw.json();
    if (response.status === 'error') {
      throw new Error(response.message);
    }
    if (response.user) {
      this.next(response.user);
    }
    return response;
  }

  public async logout(): Promise<void> {
    await isomorphicFetch(`${this.oothUrl}/logout`, {
      method: 'POST',
      credentials: 'include',
    });
    if (this.standalone) {
      await isomorphicFetch(this.apiLogoutUrl, {
        method: 'POST',
        credentials: 'include',
      });
    }
    this.next(null);
  }

  public async status(cookies: { [key: string]: string }): Promise<User | null> {
    const opts: any = {
      method: 'GET',
    };
    if (cookies) {
      opts.headers = {
        Cookie: Object.keys(cookies)
          .map((key) => `${key}=${cookies[key]}`)
          .join('; '),
      };
    } else {
      opts.credentials = 'include';
    }
    const raw = await isomorphicFetch(`${this.oothUrl}/status`, opts);
    const { user } = await raw.json();
    return this.next(user);
  }

  private next(user: User | null): User | null {
    if (this.userSubject) {
      this.userSubject.onNext(user);
    }
    return user;
  }

  private subscribeStatus(): void {
    if (typeof WebSocket !== 'undefined') {
      const urlParts = url.parse(this.oothUrl);
      const protocol = urlParts.protocol === 'https:' ? 'wss' : 'ws';
      const wsUrl = `${protocol}://${urlParts.host}${urlParts.path}/status`;
      const socket = new WebSocket(wsUrl);
      socket.onerror = (err: Error) => console.error(err);
      socket.onopen = () => {};
      socket.onclose = () => {};
      socket.onmessage = ({ data }: any) => {
        const { user } = JSON.parse(data);
        return this.next(user);
      };
    }
  }
}