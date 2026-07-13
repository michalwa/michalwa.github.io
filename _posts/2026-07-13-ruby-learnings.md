---
layout: post
title: Lessons Learned After 4+ Years of Ruby on Rails
---

# Lessons Learned After 4+ Years of Ruby on Rails

## Introduction

Until recently, I was a professional Ruby developer for over 4 years. Before that, I had used the language occasionally for small personal projects or learning. To be honest, it's never been quite up my alley. But when I was starting out, I assumed that my feelings about technologies should be put aside and that I should rather focus on building things. I still believe that to a certain extent, and I'm not saying goodbye to Ruby for good, but my opinions have matured over the years into more and more certain convictions.

I actually got into Ruby quite late, its popularity already being long in decline. I mostly worked on projects which had been started years before. _Rails_ projects specifically. I was never really interested in participating in the community aside from what I needed to do my job. The philosophy behind the language was also never really anything to write home about for me.

I do think Ruby is a good scripting language. I think it's my favorite among those, actually. The one thing I can honestly praise it for the most is how it fully takes advantage of being an interpreted language. It's unlikely you'll find object-oriented runtime metaprogramming/reflection this poweful anywhere else. You can totally bend this language to your will. This unfortunately ends up being one of the nails in its coffin when it hits production.

It's also worth mentioning that the language itself as a tool is actually not to blame for many of the shortcomings I'll describe here. Some of the criticism is perhaps more appropriately aimed at Rails specifically, rather than Ruby. But I think the nature of my complaints still demonstrates how, ultimately, the _practical Ruby experience_ involves patterns that are problematic in the long run. And I think, in this sense, the way a language is used---all the various conventions and philosophies around it, as well as its major frameworks and libraries---end up largely defining what the language actually _is_.

I will also clarify that I'm intentionally not accounting for the historical context of Ruby's development. I am simply assuming the perspective of a modern-day engineer with reasonable expectations for an actively maintained programming language and ecosystem.

## Pain

I want to take [ActiveRecord](https://github.com/rails/rails/tree/main/activerecord) as an example, because I think it really shows the worst sides of this language and ecosystem. It's an ORM and it makes **heavy** use of dynamic method generation. One particular feature it provides is implicit generation of scope methods for enum attributes. Say you have the following model:

```ruby
class Post < ActiveRecord::Base
  enum :status, %i(draft published)
end
```

This will implicitly generate the following class methods:
- `Post.draft`
- `Post.not_draft`
- `Post.published`
- `Post.not_published`

All of which return an appropriate collection/relation object.

This is all fun and games (_is it really?_) until you need to debug something and you see such a method called out in the wild. Imagine seeing the following code:

```ruby
filtered_posts.not_published
```

Imagine inspecting the resulting SQL and finding that it performs some filtering you never intended.

Now to even know where to look for the definition you need to either assume that `filtered_posts` corresponds to the `Post` class purely by mentally parsing and matching the name, or navigate to the definition of `filtered_posts` to see what it actually returns.

You could be lucky and find `filtered_posts` referencing the `Post` class, applying some scoping, and returning the resulting relation... or you might find something like this:

```ruby
def filtered_posts
  if some_condition
    Post.filter(...)
  else
    Article.filter(...)
  end
end
```

Now the code analysis path diverges. This pattern may continue indefinitely.

When you do miraculously arrive at the `Post` class, what do you do? Do you search for the definition of a method called `not_published`? No luck. What you have to do is **know** the format of the identifier that ActiveRecord may generate for a particular enum value and either **know** that such an enum exists or blindly search for `published` in hopes of finding it.

This is a contrived example, so I don't know what the ultimate issue could be here. Perhaps you find that `published` is actually a variant on a different attribute than the one you intended to filter by... You get the picture.

Mind you, Ruby's design philosophy supposedly maximizes _programmer joy_. I will proudly admit I got very good at this kind of stuff over the years, but it became increasingly difficult to find any joy in it.

## _Greppability_ disaster

[Greppability](https://morizbuesing.com/blog/greppability-code-metric) is a metric of how well a codebase can be navigated using basic text search (or `grep`). It's effectively inversely proportional to how often you will find yourself lost in the ways I mentioned earlier.

There are several stages to what I would simply call a kind of obfuscation, but let's call it _anti-greppability_ to be specific:

1. Symbols are generated by concatenating user-provided symbols with pre-determined affixes. Take the example from above, `published` gets transformed into `not_published`. This is not even that disruptive once you get used to it, because the original identifier is still contained within the generated one, and you can sort of get by in the ways I mentioned earlier.
1. Symbols are generated by inflecting user-provided symbols. This is a bizarre feature of Rails, where you call a model `Product` and the table name implicitly defaults to `products`. This wouldn't be significant if not for the fact that special cases like `Child` are correctly inflected and become `children`, same for `Person` to `people`, etc. You have to ask yourself: Why? Would it really be so bad to require explicitly specifying the table name?
1. Symbols are generated completely dynamically. If you're coming from another language you might think this is a joke, but ActiveRecord, as many other Ruby libraries, generates methods based on a completely dynamic, statically _opaque_ source, namely the database schema. And one which is only very loosely ensured to be uniform across environments. So the meaning of your code may effectively change depending on where it runs...

Keep in mind, these mechanisms are used in Rails seemingly just because they _can_ be used. I see no way in which they're vital to the design of the framework. There are many other frameworks and libraries which make use of such patterns. The mere fact that it's possible to do this in this language seems to encourage it among framework designers.

Most of this is also configurable, of course. You could very well override some of the dynamically generated symbols with explicit configuration if you wanted to. However, Rails discourages this and nobody ever does this.

Rails has a problematic interpretation of _convention over configuration_ which falls apart as soon as you realize that convention is not always sufficient and configuration is still possible, which in turn makes convention unreliable. Without very rigorous code review you will always end up with half your models relying on convention and half configured with overrides or even your own metaprogramming... You end up spending hours figuring out "_Is this something generated by Rails or should I look for the definition in our code?_" So in a way the philosophy actually ends up nurturing the confusion it's advertised to solve.

To me, all of this paints a picture of a completely impractical, toy-like technology. Fun to look at, maybe, but impractical.

## Impossible tooling

LSPs struggle significantly against this. Not only are symbols mismatched textually, there is not even a way to trace their origin programmatically. There are only a _few_ reasonable LSPs for Ruby, none of which I found very good.

In a sensible metaprogramming system you should generally provide some way to map parts of the generated code to where they originate---either in the source code of the _generator_, e.g. a macro, or the user call site where that generator is invoked. Take Rust's macros for example. There is the concept of a [span](https://doc.rust-lang.org/proc_macro/struct.Span.html) which specifically refers to a region of source code, not just a string. When you use a span in the expansion of a macro, language tooling can later trace the resulting definition to the original span.

It would be very helpful, going back to my example, if `not_published` was somehow statically accessible and referred to the original location of the `published` symbol. It would at least allow _go to definition_ functionality to some extent. But Ruby has no such capabilities. You can inspect certain properties of dynamically generated code, like `Method#source_location`, but this is hardly sufficient. The larger problem is that all such information is only available at **runtime**. There is often just no way of statically deducing what the meaning of your code is.

Even _Sorbet_ (a static type checker I'll come back to later on) has a [generator](https://github.com/Shopify/tapioca) for type shims which resorts to simply **loading the Rails application** in development and inspecting pre-defined sets of classes and symbols and inferring their types, more or less intelligently. Don't get me wrong, I find the efforts of Sorbet and its tooling commendable, given the inherent restrictions of the language they aim to support. But this is a mess.

The most helpful LSP-like editor plugins for Rails I've seen were usually implemented for specific layers of the framework, with basically hardcoded rules for symbol generation.

Some people recommended [RubyMine](https://www.jetbrains.com/ruby) to me. Supposedly it would have some superior LSP functionality. I've never used it, but I don't believe it can be significantly better because of the inherent nature of these issues, and it's a big piece of software that I don't think should be required to comfortably use a programming language.

## Dynamic typing is expensive

This is something I feel every less experienced engineer has to learn the hard way sooner or later. Dynamic typing makes sense so long as you can infer your runtime types from variable names and context alone. As soon as you are not the only person holding the entire codebase and domain context in your head, you just can't be sure what types you're dealing with anymore and end up spending hours debugging runtime type errors. It gets increasingly worse as boundaries arise between components/modules, with potentially separate teams working on either side.

I guess you can also argue that it's always a trade-off: You either get a lot of compile-time errors with static typing, or a lot of runtime errors with dynamic typing. But I don't think anyone argues that the latter is somehow preferable in large production code.

[Sorbet](https://sorbet.org) is a good attempt at putting a band-aid on existing codebases in a gradual and non-invasive way. It's quite early in development (at least up until a few months ago) and the type system makes some unfortunate trade-offs borrowed from TypeScript, which made me sad, but overall it’s worth checking out. As someone experienced with both statically typed languages and Ruby I had little to no issue gradually introducing Sorbet into a large production codebase. One thing I found it solves really nicely is missing `nil` checks. It also has reasonably powerful runtime validation (similar to `pydantic`), so it was a huge help in defining DTOs across component boundaries.

## Going forward

Getting serious stuff done in this technology requires intense discipline, contrary to the somewhat naive belief that technologies with fewer compile-time checks allow building things faster. Yes, you might roll out an MVP with _less code typed_, but the time it takes you to develop it any further will grow exponentially.

Fortunately, I think this perspective is increasingly common in the modern day. Again, Ruby's glory days have probably passed a long time ago, together with other similar technologies. I think Python today usually has type hints and you will get reasonable static checks and not a lot of runtime macro voodoo.

Were I to pick up a Ruby codebase today, I would be **extremely** mindful of the level of code style standards it employs, to make sure it at least tries not to make these issues worse.
