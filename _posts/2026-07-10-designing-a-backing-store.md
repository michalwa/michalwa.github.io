---
layout: post
title: Designing a Backing Store for a Prolog-based PKM Application
---

# Designing a Backing Store for a Prolog-based PKM Application

## The problem

[**factbook**](https://github.com/michalwa/factbook) is my personal PKM app developed as a hobby project. What makes it unique among PKM systems is that it delegates its filtering logic entirely to its scripting layer built on top of Prolog.

Prolog is a logic programming language. Aside from being 100% Turing-complete, logic problems and relational search are where it shines most. The interpreter has built-in concepts of so-called _choice points_ and _backtracking_. This machinery can be very powerful and versatile in the right hands. The language itself is quite similar to the LISP family in many ways. Although it doesn’t use S-expressions, it has powerful first-class support for _code as data_. It’s defined a completely new paradigm and perspective on programming for me, which I always find both valuable and fun. From what I understand, people usually get introduced to Prolog in an academic setting, but I just stumbled upon it one day in my spare time and got hooked.

The way factbook attempts to take advantage of this technology is by allowing users to tag their entries with arbitrary Prolog _terms_. In short this means instead of simple tags like `#book` or `#task`, you can write `@book([read(false), rating(3)])`, etc. meaning you can pretty much embed arbitrary data structures in your notes, which I think it pretty cool. The way you can then reason about these tags is by means of queries, which are made to look more or less like a subset of Prolog, allowing you to pretty much use the entire language to your advantage, with some quality-of-life features added on top.

The idea for the app kind of just appeared in my head at some point. I’ve always used PKM and note-taking apps in a very specific, over-engineered way :) So it just seemed like an interesting idea potentially leading to an actual usable product, or at least usable by me :) And I hadn’t found any similar attempts anywhere. Though similar tools in general do exist, most noteworthy probably being Emacs Org Mode.

Let me show you an example. Here’s what a _journal_ in factbook might look like. Entries are numbered for later reference; in the actual app they are annotated with timestamps.

```
0 | @todo(false) this is an uncompleted task
1 | @todo(true) this is a completed task
2 | this is a @todo(false) in the context of @work
3 | this is a @thought where I want to @cite("Einstein", 1905)
4 | another @thought
5 | some research @cite("Turing", 1936)
```

Now, say you want to list all uncompleted tasks. You would simply use the query `@todo(false)` for that.

But there’s obviously also boolean operators for conjunction (`,`) and disjunction (`;`), so you can say things like `@todo(false); @thought, @cite(_, _)` (_uncompleted tasks or thoughts which cite something_).

There’s also other predicates which don’t refer to tags, but for example let you reason about the creation times of entries (`created(_)`); or allow you to execute completely arbitrary Prolog code (`{ ... }`). This naturally includes accessing the file system or making web requests, not that you should necessarily do those things :)

Doing this kind of search in Prolog on its own is trivial. However, the problematic part is that for the purposes of the app we need to store the actual contents of each entry, parse it when it changes, and synchronize the associated terms available to the Prolog runtime. Some of them may get removed, changed, entire entries may get removed, etc. This is where the engineering story begins.

## The obvious solution

Prolog maintains an internal database of definitions which you populate and subsequently query. Most of these definitions can be categorized into _rules_ and _facts_.

Rules are expressions which use logical implication `:-` to derive predicates. For example, the rule `ground_wet :- just_rained.` will define the predicate `ground_wet/0` (0 indicates arity) which will succeed if the predicate `just_rained/0` succeeds. Rules can more or less be thought of as _boolean functions_ in other languages, especially since they can also include side effects which will be triggered sequentially as the solver progresses through the right-hand side of the definition.

Facts on the other hand are expressions which simply declare a particular set of invocations of a predicate to be true, without depending from other predicates. For example, the fact `ground_wet.` will make the predicate `ground_wet/0` succeed unconditionally.

Let’s see what our example entry database could look like written in terms of Prolog facts:

```prolog
entry_tag(0, todo(false)).
entry_tag(1, todo(true)).
entry_tag(2, todo(false)).
entry_tag(2, work).
entry_tag(3, thought).
entry_tag(3, cite("Einstein", 1905)).
entry_tag(4, thought).
entry_tag(5, cite("Turing", 1936)).
```

As you can see, we define the relation `entry_tag/2` which associates an entry ID with a tag included in the entry. To then retrieve IDs of entries containing the `todo/1` tag, we could use the following Prolog query: `?- entry_tag(E, todo(_)).`

These kinds of _clauses_ make up most of Prolog programs. They are typically declared inside of a `.pl` file, loaded either at startup or at some later point while working with the interpreter, and then either interactively queried, or called via a particular entry point _goal_.

The obvious issue is that for the purposes of my app, I wouldn’t want to have to regenerate this database and boot up a fresh Prolog runtime every time a single entry changes.

Well, it turns out you can also declare facts and rules at “query time” using `asserta/1` and `assertz/1`. These are predicates, which you can query just like other predicates, including as part of rules, but have the special side effect of mutating the Prolog database by either prepending or appending facts or rules. There are also a bunch of related predicates for retracting clauses.

Let’s see what an example change could look like. Say we change the content of entry 0 from “_@todo(false) this is an uncompleted task_” to “_@todo(true) this is a completed task_”. How can we update the Prolog database accordingly?

Well, to be safe we would probably need to first retract all facts about that entry:

```prolog
retract(entry_tag(0, _)).
```

And subsequently assert the facts corresponding to each of the new tags:

```prolog
assertz(entry_tag(0, todo(true))).
```

If the entry got deleted as a whole, we would only do the retraction.

This might seem like **the** solution at first glance and, to be fair, I have not honestly tested this and verified its performance. It could turn out that for small sets of entries it’s completely viable. However, I immediately got a strong gut feeling that this would not be the way to go. In a professional setting, I would probably go through the effort of actual prototyping to have concrete measurements to base my judgment on. In my hobby project I get to skip that part :) But let me try to explain why I felt that way:

- I make actual performance judgments warily, having skipped actual benchmarking, but I reckon the universal nature of the dynamic database must ultimately prove worse than a custom backing store tailored to the specific common mutations occuring in the app.
- In any case, relying on the Prolog database gives limited to no control over the way tags are stored and search performance. In SWI-Prolog there are ways to ensure that the asserted clauses are properly indexed, for example, to allow efficient search. But ultimately you give up most of the performance fine-tuning to the specifics of the Prolog implementation.
- From an architectural perspective, tying the performance of data storage to Prolog does not seem ideal either. I would like Prolog to be scoped to only the functionality it is specifically intended to enable in the application.
- In the near future I would also like to implement things like full-text search integrated into the query interface. I doubt this can be implemented reliably and efficiently in Prolog, and so it will most likely need a native implementation. It would then be nice to keep indexing text consistent with indexing terms, perhaps even reusing certain components between them.

There are some potential functional concerns when it comes to some niche features like unifying variables across tags in the scope of an entry. For example, if you have an entry like `@foo(X) @bar(X)` and would want `X` to refer to the same variable in both instances, asserting that into the dynamic database would probably require composing all tags within an entry into a single term:

```prolog
assertz(entry_tags(0, [foo(X), bar(X)])).
```

Otherwise variables seem to be scoped to each invocation of `assertz/1`. And this approach would probably be quite bad for indexing (you can’t index by the functor of the tag anymore). But this is arguably an extremely contrived feature that I’m only planning to add because it’s fun to think about :)

All in all, I think engineering an efficient solution entirely in Prolog would be a very interesting challenge in itself. I chose not to go that way.

## Setup

The way you interface with the Prolog interpreter is split into 2 aspects:

**Constructing terms:** This is done with functions like `PL_put_...`, e.g. `PL_put_atom`, which you call “bottom-up” to construct your term trees.

In my [Rust wrapper](https://github.com/michalwa/factbook/tree/main/factbook-swipl) I wrote a macro which allows me to do this more conveniently, e.g. `term! { &pl => entry_tag(0, todo(true)) }`. But you can also simply delegate parsing to Prolog itself using `PL_put_term_from_chars`, with some limitations.

The one crucial use of this is for constructing the _goal_ term for querying. Otherwise I mostly use this in unit tests for the wrapper itself. There’s also some built-in predicates which I could potentially call this way to configure the runtime.

**Calling Rust from Prolog:** This is where the magic happens. You can define so-called _foreign predicates_, which are basically predicates with a native implementation that will be called to obtain solutions. The implementation is free to emulate all of the properties of a regular predicate.

There are generally several _modes_ of predicates, the two which are relevant here being _semi-determinate_ and _non-determinate_. The former are allowed either to fail or to succeed exactly once (producing a single solution). The latter may succeed an arbitrary number of times, producing separate (not necessarily distinct) solutions.

In my wrapper, I have two traits describing this (simplified):

```rust
trait Semidet {
    fn call(args: &[Term]) -> bool;
}

trait Nondet {
    fn init() -> Self;
    fn next(&mut self, args: &[Term]) -> bool;
}
```

As you can see, non-determinate predicates are allowed to construct a state and mutate it upon each invocation during search.

The way you actually yield values from a predicate is by _unifying_ the arguments with other terms. Without going into unnecessary detail, you may think of the type `Term` as being a kind of mutable reference or “out parameter”, which the predicate may write to before returning `true`.

Terms may contain arbitrary blobs, meaning we can actually embed references to arbitrary state into the goal term and pass it down to our foreign predicate implementation.

All of this lets us construct the core infrastructure that will allow us to implement any kind of search natively in Rust and make it available to Prolog.

![architecture diagram](/assets/images/factbook-search-arch.svg)

## So far so good

Okay, but we are left with actually implementing the search.

Let’s first assume our native predicate will have a similar signature to what we initially sketched out, meaning: `entry_tag(Id, Tag)`. Since we know we’ll have to pass external context, let’s also include that as an argument: `entry_tag(Ctx, Id, Tag)`. This context will include a reference to the actual storage of entires, as well as any indexes or caches we decide to maintain for support.

Let’s now think about some example invocations and what they should return:

```prolog
entry_tag(_, E, foo). % `Ctx` is omitted here, because it has to be constructed natively
```

This should obviously yield solutions for `E` where the entry contains the tag `@foo`. You can imagine having a simple inverse index of tag names to efficiently traverse entries sharing the same tag. In cases where the tag is a compound term, we can simply use the functor as the index:

```prolog
entry_tag(_, E, todo(_)). % search by `todo/1`
```

We could also choose to index based on a predetermined number of initial arguments, or allow users to choose their own indexing strategies based on the intended usage of the functors. This is definitely also worth exploring, but can be regarded as a separate issue. For now we just assume that there is _some_ way of extracting information from tags that will serve as a kind of _hash function_ and allow building indexes.

So what’s the problem? Well, imagine you have a query even slightly more complex than a single tag predicate:

```
@thought, @cite(_, _)
```

The predicate invocation would look like this:

```prolog
entry_tag(C, E, thought), entry_tag(C, E, cite(_, _)).
```

Without any additional optimizations, we suddenly arrive at quadratic time complexity. For each solution yielded by the first invocation of `entry_tag`, Prolog will invoke the second one and attempt to unify each produced pair of solutions. This will scale terribly.

Here’s a visualization of this using our initial example journal:

```
entry_tag(C, E, thought)
index search yields `E = 3` and `E = 4`
  -> entry_tag(C, E1, cite(_, _))
     index search yields `E1 = 3` and `E1 = 5`
       -> `3 = 3`: true
       -> `3 = 5`: false
  -> entry_tag(C, E2, cite(_, _))
     index search yields `E2 = 3` and `E2 = 5`
       -> `4 = 3`: false
       -> `4 = 5`: false
```

An easy optimization before jumping into any further rabbit hole is to traverse entries instead of tags when possible. We can simply detect whether `entry_tag` is called with an already unified `Id` argument, and then choose to iterate over other tags in the same entry instead of all entries matching the tag. This is much better, because entries will realistically contain much fewer tags than there will be entries matching that tag.

```
entry_tag(C, E, thought)
index search yields `E = 3` and `E = 4`
  -> entry_tag(C, 3, cite(_, _))
     entry contains tags `thought` and `cite("Einstein", 1905)`
       -> `cite(_, _) = thought`: false
       -> `cite(_, _) = cite("Einstein", 1905)`: true
  -> entry_tag(C, 4, cite(_, _))
     entry contains tags `thought`
       -> `cite(_, _) = thought`: false
```

So the initial index search helps us greatly narrow down the search space, but then we fall back to linear scans assuming realistically smaller data sets.

This is actually the way the predicate is designed and implemented at the time of writing this article. It strikes a good balance between implementation simplicity and performance.

## Taking it further

The solution is of course still suboptimal for certain use cases. Namely, for a conjunction query like in the example above, the two tags may only share a small subset of associated entries, in which case the first specified tag will determine the time it takes to find them, performing a lot of wasted iterations.

Ideally we would want to support an efficient way to find solutions for arbitrary boolean expressions.

This is obviously the opening of a huge rabbit hole. I have to be mindful of how deep I want to get into this and careful not to find myself having to implementing some kind of full-featured relational database.
