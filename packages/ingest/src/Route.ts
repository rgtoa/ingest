//stackpress
import type { UnknownNest } from '@stackpress/types/dist/types';
import Status from '@stackpress/types/dist/Status';
//local
import type Server from './Server';
import type Request from './Request';
import type Response from './Response';
import Exception from './Exception';

/**
 * Plugable route handler
 * 
 * - before (request) hook
 * - after (response) hook
 * - properly formats the response
 */
export default class Route<
  //configuration map
  C extends UnknownNest = UnknownNest, 
  //request resource
  R = unknown, 
  //response resource
  S = unknown
> {
  /**
   * Hooks in plugins to the request lifecycle
   */
  public static async emit<
    C extends UnknownNest = UnknownNest, 
    R = unknown, 
    S = unknown
  >(
    event: string,
    request: Request<R, Server<C, R, S>>,
    response: Response<S>
  ) {
    const route = new Route(event, request, response);
    return route.emit();
  }

  public readonly event: string;
  public readonly request: Request<R, Server<C, R, S>>;
  public readonly response: Response<S>;

  /**
   * Gets everything needed from route.handle()
   */
  constructor(
    event: string,
    request: Request<R, Server<C, R, S>>,
    response: Response<S>
  ) {
    this.event = event;
    this.request = request;
    this.response = response;
  }

  /**
   * Hooks in plugins to the request lifecycle
   */
  public async emit() {
    //try to trigger request pre-processors
    if (!await this.prepare()) {
      //if the request exits, then stop
      return false;
    }
    // from here we can assume that it is okay to
    // continue with processing the routes
    if (!await this.process()) {
      //if the request exits, then stop
      return false;
    }
    //last call before dispatch
    if (!await this.shutdown()) {
      //if the dispatch exits, then stop
      return false;
    }
    return true;
  }

  /**
   * Runs the 'request' event and interprets
   */
  public async prepare() {
    //default status
    let status = Status.OK;
    try { //to allow plugins to handle the request
      status = await this.request.context.emit(
        'request', 
        this.request, 
        this.response
      );
    } catch(error) {
      //allow plugins to handle the error
      status = await this._catch(error as Error);
    }
    //if the status was incomplete (309)
    return status.code !== Status.ABORT.code;
  }

  /**
   * Handles a payload using events
   */
  public async process() {
    //default status
    let status = Status.OK;
    try { //to emit the route
      await this.request.context.emit(
        this.event, 
        this.request, 
        this.response
      );
    } catch(error) {
      //allow plugins to handle the error
      status = await this._catch(error as Error);
    }
    //if the status was incomplete (309)
    if (status.code === Status.ABORT.code) {
      //the callback that set that should have already processed
      //the request and is signaling to no longer continue
      return false;
    }
    //if no body and status code
    //NOTE: it's okay if there is no body as 
    //      long as there is a status code
    //ex. like in the case of a redirect
    if (!this.response.body && !this.response.code) {
      //make a not found exception
      const exception = Exception
        .for(Status.NOT_FOUND.status)
        .withCode(Status.NOT_FOUND.code)
        .toResponse();
      //set the exception as the error
      this.response.setError(exception);
      //allow plugins to handle the not found
      status = await this.request.context.emit(
        'error', 
        this.request, 
        this.response
      );
    }
    //if no status was set
    if (!this.response.code || !this.response.status) {
      //make it okay
      this.response.status = Status.OK;
    }
    //if the status was incomplete (309)
    return status.code !== Status.ABORT.code;
  }

  /**
   * Runs the 'response' event and interprets
   */
  public async shutdown() {
    //default status
    let status = Status.OK;
    try { //to allow plugins to handle the response
      status = await this.request.context.emit(
        'response', 
        this.request, 
        this.response
      );
    } catch(error) {
      //allow plugins to handle the error
      status = await this._catch(error as Error);
    }
    //if the status was incomplete (309)
    return status.code !== Status.ABORT.code;
  }

  /**
   * Default error flow
   */
  protected async _catch(error: Error) {
    //if there is an error
    const event = this.request.context.event;
    //upgrade the error to an exception
    const exception = !(error instanceof Exception) 
      ? Exception.upgrade(error as Error)
      : error;

    if (event) {
      exception.withEvent(this.request.context.event);
    }
    //set the exception as the error
    this.response.setError(exception.toResponse());
    //allow plugins to handle the error
    return await this.request.context.emit(
      'error', 
      this.request, 
      this.response
    );
  }
}